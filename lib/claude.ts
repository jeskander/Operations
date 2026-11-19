import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { BetaMessageParam, BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { normalize } from "./content";
import type { Consultant, Operation, Proposal } from "./types";

const MODEL = "claude-opus-5-5";
const HAIKU = "claude-haiku-5-5";
// On a policy decline, the API re-runs the request on a fallback model it picks by category.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Claude API key missing or invalid";
  if (err instanceof Anthropic.RateLimitError) return "Claude is busy. Try again in a moment.";
  if (err instanceof Anthropic.APIError) return err.message;
  return err instanceof Error ? err.message : "Something went wrong";
}

// ---------- Editing a page ----------

const s = { type: "string" } as const;
const sOrNull = { type: ["string", "null"] } as const;
const obj = (properties: Record<string, unknown>, description?: string) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
  ...(description ? { description } : {}),
});
const list = (items: unknown, description?: string) => ({ type: "array", items, ...(description ? { description } : {}) });

const PROPOSE_TOOL: BetaToolUnion = {
  name: "propose_page",
  description: "Submit the whole operation page with the surgeon's instruction applied. Call exactly once, last.",
  strict: true,
  input_schema: obj({
    summary: list(s, "Each change you made, one short line each, e.g. 'Approach: added \"keep incision low for Mako\" [Mako]'. Empty if nothing changed."),
    name: s,
    region: s,
    subtitle: { type: "string", description: "A few words under the name in the list, e.g. 'Attune · Medacta · Mako'." },
    new_consultants: list(obj({ id: s, name: s }), "Consultants not yet in the list that this change mentions. Give each a new id and use it on items."),
    kits: list(obj({ id: s, name: s, maker: s, url: { type: "string", description: "Op tech link, or empty." } })),
    techniques: list(obj({ id: s, name: s }), "e.g. Conventional, Robotic (Mako). Only when steps differ by technique."),
    blocks: list(
      obj({
        id: s,
        type: { type: "string", enum: ["toggle", "heading", "bullet", "number", "text", "todo", "quote", "code", "divider", "image"] },
        text: { type: "string", description: "Short. **bold** and *italic* allowed." },
        depth: { type: "integer", description: "Nesting: 0 at the top, or at most one more than the block above it." },
        kit: { ...sOrNull, description: "A kit id if this block (and everything nested in it) applies only to that kit" },
        technique: { ...sOrNull, description: "A technique (mode) id if only for that technique" },
        consultant: { ...sOrNull, description: "A consultant id if only for that consultant" },
        level: { type: ["integer", "null"], description: "Heading level 1-3 for a heading; null otherwise" },
        checked: { type: ["boolean", "null"], description: "Whether a to-do is ticked; null otherwise" },
        url: { ...sOrNull, description: "An image's address (keep existing ones as they are); null otherwise" },
      }),
      "The steps of the operation as blocks in reading order.",
    ),
    videos: list(obj({ id: s, title: s, url: s, source: s, note: s, group: { type: "string", enum: ["full", "other"] } })),
    links: list(obj({ id: s, title: s, url: s, source: s, note: s })),
    questions: list(obj({ id: s, q: s, a: { type: "string", description: "Markdown answer; tables allowed." } })),
  }) as never,
};

const SYSTEM = `You keep a UK trauma & orthopaedic surgeon's personal notes on operations. Each operation is one page:
- blocks: the steps, Notion-style, as a flat list in reading order. depth nests a block inside the nearest shallower block above it. Top-level toggles (type "toggle", depth 0) are the parts of the operation in the order they happen (e.g. Pre-op & huddle, Position & draping, Approach, then the operation's own steps, Closure, Post-op), with bullet or numbered blocks nested inside them (depth 1, deeper for sub-points). A toggle nested in a part is a sub-part (e.g. Procedure › Insert guide wire).
- Any block can be tagged for one kit, one technique (mode, e.g. robotic vs conventional) or one consultant; it and everything nested in it then show only when that one is chosen. Tag a whole part by tagging its toggle. Blocks that apply to everyone have no tag.
- kits: implant systems used for this operation, each with its op tech link.
- videos (group "full" for the operation being performed, "other" for anything else), links (AO Surgery Reference, approaches, op note templates…), questions: the knowledge relevant to this case, as questions a consultant would ask, with answers.

Apply the surgeon's instruction to the page and submit the whole page with propose_page.
- Change only what the instruction asks. Keep every other id, line and wording exactly as it is.
- File each learning in the right part, at the right point in the order, in the surgeon's own terse style. Use British spelling.
- If a learning applies to one kit, technique or consultant, mark it with that id. Add a kit, technique or consultant if it doesn't exist yet. New things get new ids: 8 random lowercase letters and digits.
- Don't merge, reword or tidy lines you weren't asked to touch.
- Search the web only when asked for videos, links or op techs, and only use URLs that appeared in your search results. Never write a URL from memory.
- When asked to write knowledge or steps, be accurate and say so in the summary if something needs checking.
- If the instruction is only a question, answer it in the summary and leave the page unchanged.`;

const webSearch: BetaToolUnion = { type: "web_search_20260209", name: "web_search", max_uses: 8 };

type ProposeInput = {
  summary: string[];
  name: string;
  region: string;
  subtitle: string;
  new_consultants: Consultant[];
  kits: unknown;
  techniques: unknown;
  blocks: unknown;
  videos: unknown;
  links: unknown;
  questions: unknown;
};

function pageText(op: Operation, consultants: Consultant[]): string {
  const { content, name, region, subtitle } = op;
  return JSON.stringify({ name, region, subtitle, consultants, ...content });
}

export async function proposeEdit(op: Operation, consultants: Consultant[], instruction: string, standing = ""): Promise<Proposal> {
  const system = standing.trim() ? `${SYSTEM}\n\n<surgeon_standing_instructions>\n${standing.trim()}\n</surgeon_standing_instructions>` : SYSTEM;
  const messages: BetaMessageParam[] = [
    {
      role: "user",
      content: `<page>\n${pageText(op, consultants)}\n</page>\n\n<instruction>\n${instruction}\n</instruction>`,
    },
  ];

  for (let turn = 0; turn < 6; turn++) {
    const response = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 32000,
      ...FALLBACK,
      system,
      output_config: { effort: "medium" },
      tools: [webSearch, PROPOSE_TOOL],
      messages,
    });
    if (response.stop_reason === "refusal") throw new Error("Claude declined this change.");
    if (response.stop_reason === "max_tokens") throw new Error("The page ran too long for one change.");

    const call = response.content.find((b) => b.type === "tool_use" && b.name === "propose_page");
    if (call && call.type === "tool_use") {
      const input = call.input as ProposeInput;
      const content = normalize(input);
      return {
        summary: Array.isArray(input.summary) ? input.summary.filter((x) => typeof x === "string") : [],
        operation: { name: input.name || op.name, region: input.region || op.region, subtitle: input.subtitle ?? op.subtitle, content },
        newConsultants: Array.isArray(input.new_consultants) ? input.new_consultants.filter((c) => c?.id && c?.name) : [],
      };
    }

    messages.push({ role: "assistant", content: response.content });
    // A long web search pauses the turn; otherwise remind it to submit.
    if (response.stop_reason !== "pause_turn") messages.push({ role: "user", content: "Call propose_page now with the whole page." });
  }
  throw new Error("Claude didn't finish the change.");
}

// ---------- Which operation a learning belongs to ----------

const Route = z.object({
  intent: z
    .enum(["learning", "question"])
    .describe("question: the surgeon is asking something and wants an answer. learning: a tip, step or change to file on a page."),
  relevant_operation_ids: z
    .array(z.string())
    .describe("For a question: ids of up to 4 existing operations whose pages help answer it (empty if none)."),
  operation_id: z.string().nullable().describe("The id of the existing operation this is about, or null if none fits."),
  new_operation_name: z
    .string()
    .nullable()
    .describe("If no existing operation fits, the name for a new one as a surgeon would write it, e.g. 'Total Knee Replacement'. Otherwise null."),
  region: z.string().nullable().describe("For a new operation: Hip, Knee, Foot & ankle, Shoulder & elbow, Hand & wrist, Spine, Paeds, Trauma or General."),
});

export async function routeLearning(text: string, ops: { id: string; name: string }[], context = "") {
  const response = await anthropic().messages.parse({
    model: HAIKU,
    max_tokens: 2000,
    system:
      "A T&O surgeon typed something into their operations notebook. First decide whether it is a question to answer or a learning to file. Then pick which of their existing operations it is about. Match loosely: abbreviations (TKR, DHS, THR, ORIF), sides and implant names all point to the operation. For a learning, only suggest a new operation if none fits. For a question, list the operations whose pages help answer it; earlier conversation is given for follow-ups.",
    output_config: { effort: "low", format: zodOutputFormat(Route) },
    messages: [
      {
        role: "user",
        content: `<operations>\n${ops.map((o) => `${o.id}: ${o.name}`).join("\n") || "(none yet)"}\n</operations>\n\n${context ? `<earlier_conversation>\n${context}\n</earlier_conversation>\n\n` : ""}<note>\n${text}\n</note>`,
      },
    ],
  });
  const out = response.parsed_output;
  if (!out) throw new Error("Couldn't tell which operation this is about");
  return {
    intent: out.intent,
    relevantIds: out.relevant_operation_ids.filter((id) => ops.some((o) => o.id === id)).slice(0, 4),
    operationId: out.operation_id && ops.some((o) => o.id === out.operation_id) ? out.operation_id : null,
    newName: out.new_operation_name?.trim() || null,
    region: out.region?.trim() || null,
  };
}

// ---------- Answering a question across operations ----------

const ASK_SYSTEM = `You answer questions from a UK trauma & orthopaedic surgeon about operations, using their own operations notebook.

- The <pages> are the surgeon's own notes for the relevant operations: steps, tips per kit, mode and consultant, videos, links and Q&A. Base the answer on them first, and say which operation a point comes from when that helps.
- If the notes don't cover it, say so briefly, then answer from your own knowledge, clearly marked as not from their notes. Search the web only when the answer needs a current source, a video or a link, and only use URLs from your search results.
- Be terse and practical, like a senior colleague in theatre. Short bullet points. British spelling. Markdown only for bullets, bold and links.
- Never change anything; if they want something added, tell them to say it as a learning (e.g. "Add to TKR: …").`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function answerQuestion(history: ChatTurn[], pages: Operation[], allNames: string[], consultants: Consultant[]): Promise<string> {
  const pagesText = pages.map((op) => `<page>\n${pageText(op, consultants)}\n</page>`).join("\n") || "(no relevant pages found)";
  const turns = history.slice(-10);
  const last = turns[turns.length - 1];
  const messages: BetaMessageParam[] = [
    ...turns.slice(0, -1).map((t) => ({ role: t.role, content: t.content })),
    {
      role: "user",
      content: `<all_operations>\n${allNames.join("\n")}\n</all_operations>\n\n<pages>\n${pagesText}\n</pages>\n\n<question>\n${last.content}\n</question>`,
    },
  ];
  let answer = "";
  for (let turn = 0; turn < 4; turn++) {
    const response = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      ...FALLBACK,
      system: ASK_SYSTEM,
      output_config: { effort: "low" },
      tools: [webSearch],
      messages,
    });
    if (response.stop_reason === "refusal") throw new Error("Claude declined to answer this.");
    answer += response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  return answer.trim() || "No answer came back. Try asking again.";
}

// ---------- The simple version: one note ----------

const NOTE_TOOL: BetaToolUnion = {
  name: "propose_note",
  description: "Submit the whole note with the surgeon's instruction applied. Call exactly once, last.",
  strict: true,
  input_schema: obj({
    summary: list(s, "Each change you made, one short line each. Empty if nothing changed."),
    html: { type: "string", description: "The whole note as HTML, using only the allowed tags." },
  }) as never,
};

const NOTE_SYSTEM = `You keep a UK trauma & orthopaedic surgeon's personal note on one operation: their steps, tips, learnings, videos, links and knowledge, all in one note.

The note is HTML using only these tags:
- <h2> and <h3> headings
- <p> paragraphs, with <strong>, <em>, <u> and <a href="…"> inside
- <ul> / <ol> lists of <li><p>…</p></li>, nested by putting a list inside an <li>
- collapsible toggles: <details open><summary>Title</summary><div data-type="detailsContent">…</div></details> (leave out "open" for a closed one)
Nothing else: no tables, images, code, colours, classes or styles.

Apply the surgeon's instruction and submit the whole note with propose_note.
- Change only what the instruction asks. Keep everything else exactly as it is, including whether each toggle is open.
- File each learning in the right place in the order of the operation, in the surgeon's own terse style. Use British spelling.
- Something that applies to one kit, robotic vs conventional, or one consultant goes in brackets at the start of the line, e.g. "(Mako) keep the incision low".
- Videos and links go as list items under a "Videos" or "Links" heading. Search the web only when asked for videos, links or op techs, and only use URLs from your search results; never write one from memory.
- When asked to write knowledge, use a toggle per question with the answer inside. Be accurate, and say in the summary if something needs checking.
- If the instruction is only a question, answer it in the summary and leave the note unchanged.`;

export async function proposeNote(note: string, opName: string, instruction: string, standing = ""): Promise<{ summary: string[]; html: string }> {
  const system = standing.trim() ? `${NOTE_SYSTEM}\n\n<surgeon_standing_instructions>\n${standing.trim()}\n</surgeon_standing_instructions>` : NOTE_SYSTEM;
  const messages: BetaMessageParam[] = [
    { role: "user", content: `<operation>${opName}</operation>\n\n<note>\n${note}\n</note>\n\n<instruction>\n${instruction}\n</instruction>` },
  ];
  for (let turn = 0; turn < 6; turn++) {
    const response = await anthropic().beta.messages.create({
      model: MODEL,
      max_tokens: 32000,
      ...FALLBACK,
      system,
      output_config: { effort: "medium" },
      tools: [webSearch, NOTE_TOOL],
      messages,
    });
    if (response.stop_reason === "refusal") throw new Error("Claude declined this change.");
    if (response.stop_reason === "max_tokens") throw new Error("The note ran too long for one change.");
    const call = response.content.find((b) => b.type === "tool_use" && b.name === "propose_note");
    if (call && call.type === "tool_use") {
      const input = call.input as { summary?: unknown; html?: unknown };
      return {
        summary: Array.isArray(input.summary) ? input.summary.filter((x): x is string => typeof x === "string") : [],
        html: typeof input.html === "string" && input.html.trim() ? input.html : note,
      };
    }
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason !== "pause_turn") messages.push({ role: "user", content: "Call propose_note now with the whole note." });
  }
  throw new Error("Claude didn't finish the change.");
}
