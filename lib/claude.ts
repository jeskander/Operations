import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { BetaMessageParam, BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { applyEdits, pageOutline, type Edit } from "./edits";
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

const NEW_BLOCK = {
  type: "object",
  properties: {
    id: { type: "string", description: "Leave out for a new line. Only give an existing id when re-placing that same line in a rewritten section." },
    type: { type: "string", enum: ["toggle", "heading", "bullet", "number", "text", "todo", "quote", "code", "divider"] },
    text: { type: "string", description: "Short. **bold** and *italic* allowed." },
    depth: { type: "integer", description: "Relative nesting: 0 = the level of the place it goes, 1 = nested under the line before it, and so on." },
    kit: { type: ["string", "null"] },
    technique: { type: ["string", "null"], description: "A mode id" },
    consultant: { type: ["string", "null"] },
    level: { type: ["integer", "null"], description: "1-3 for a heading" },
  },
  required: ["type", "text", "depth"],
};

const EDIT_TOOL: BetaToolUnion = {
  name: "edit_page",
  description: "Submit the edits that apply the surgeon's message to the page. Call exactly once, last.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "array",
        items: { type: "string" },
        description:
          "What you did, one short line each, saying where: 'Approach: added \"keep incision low\" [Mako]', 'Removed from Draping: \"cut the U drape\" (no longer done)', 'Tibial cut: changed 10 mm → 9 mm', 'Moved Patella before Femur'. Last, anything you weren't sure about or couldn't place, starting 'Check:'. Empty if nothing changed.",
      },
      edits: {
        type: "array",
        description: "Applied in order. Line ids are the [ids] in the page outline.",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["insert", "update", "delete", "move", "replace_section", "replace_all_blocks", "add_item", "update_item", "remove_item", "set_page"],
              description:
                "insert: new lines at a place. update: change one line's text, type or tags (leave out fields you're not changing; null clears a tag). delete: remove a line and everything nested in it. move: move a line with everything nested in it to a place. replace_section: rewrite one line and everything nested in it (use to reorganise a part). replace_all_blocks: rewrite all the steps (only to restructure the whole operation, or to write up an empty page). add_item / update_item / remove_item: kits, modes, consultants, videos, links or questions. set_page: name, region or subtitle.",
            },
            id: { type: "string", description: "The line (or list item) this edit is about." },
            after: { type: "string", description: "Place: straight after this line and everything nested in it, at the same level." },
            before: { type: "string", description: "Place: just before this line, at the same level." },
            inside: { type: "string", description: "Place: nested inside this line (a part or sub-part), at its end unless at is 'start'." },
            at: { type: "string", enum: ["start", "end"] },
            blocks: { type: "array", items: NEW_BLOCK, description: "For insert, replace_section and replace_all_blocks." },
            text: { type: "string" },
            type: { type: "string" },
            kit: { type: ["string", "null"] },
            technique: { type: ["string", "null"] },
            consultant: { type: ["string", "null"] },
            level: { type: ["integer", "null"] },
            checked: { type: ["boolean", "null"] },
            list: { type: "string", enum: ["kits", "techniques", "consultants", "videos", "links", "questions"] },
            item: {
              type: "object",
              description:
                "kits {id, name, maker, url}; techniques {id, name}; consultants {id, name}; videos {title, url, source, note, group: 'full'|'other'}; links {title, url, source, note}; questions {q, a}. New kits, modes and consultants need an id you choose (8 lowercase letters/digits) so lines can be tagged with it.",
            },
            name: { type: "string" },
            region: { type: "string" },
            subtitle: { type: "string" },
          },
          required: ["action"],
        },
      },
    },
    required: ["summary", "edits"],
  } as never,
};

const SYSTEM = `You keep a UK trauma & orthopaedic surgeon's personal notes on operations. Each operation is one page:
- steps: Notion-style lines, nested by indentation. Top-level toggles are the parts of the operation in the order they happen (e.g. Pre-op & huddle, Position & draping, Approach, then the operation's own stages, Closure, Post-op), with bullets or numbered lines inside them, deeper for sub-points. A toggle inside a part is a sub-part (e.g. Procedure › Insert guide wire).
- Any line can be tagged for one kit, one mode (e.g. Mako vs conventional) or one consultant; it and everything nested in it then show only when that one is chosen. Tag a whole part by tagging its toggle. Lines that apply to everyone have no tag.
- kits: implant systems with their op tech link. videos, links, and questions: knowledge as questions a consultant would ask, with answers.

The surgeon usually dictates a debrief after doing the operation: a long, loosely spoken message mixing steps, tips, corrections, consultant preferences and things they didn't know. Apply it to the page with edit_page.

How to file a debrief:
- Split it into separate points. Put each in the right part, at the right point in the order, in the surgeon's terse theatre style: one action per line, the reason or trick in brackets, real numbers. British spelling. Don't copy the spoken wording or filler.
- Skip points the page already says. If a point adds detail to an existing line, update that line rather than adding a near-duplicate.
- The message is the latest truth. If it corrects or contradicts the page, update or delete the old line; don't keep both. If it says something is no longer done, delete it.
- If the message describes the steps in a different order from the page, move lines or parts to match. To reorganise a whole part, use replace_section; to restructure the whole operation, replace_all_blocks.
- "Mr X likes…", "for Kyani…": tag that line with the consultant (add them to consultants if new). Same for a kit or mode.
- "I didn't know…", "he asked me…": add a question with a short accurate answer.
- Only change what the message is about. Leave every other line exactly as it is. If you're unsure whether a line is outdated or just not mentioned, keep it and say so in the summary.
- If something can't be placed or is ambiguous, file your best guess and list it under 'Check:' in the summary.

Other messages ("tidy the approach", "add videos", "write up X"): do just that.
- Search the web only when asked for videos, links or op techs, and only use URLs that appeared in your search results. Never write a URL from memory.
- When writing steps or knowledge, be accurate and flag anything that needs checking.
- If the message is only a question, answer it in the summary and make no edits.`;

const webSearch: BetaToolUnion = { type: "web_search_20260209", name: "web_search", max_uses: 8 };

function pageText(op: Operation): string {
  return pageOutline(op);
}

export async function proposeEdit(op: Operation, instruction: string, standing = ""): Promise<Proposal> {
  const system = standing.trim() ? `${SYSTEM}\n\n<surgeon_standing_instructions>\n${standing.trim()}\n</surgeon_standing_instructions>` : SYSTEM;
  const messages: BetaMessageParam[] = [
    {
      role: "user",
      content: `<page>\n${pageText(op)}\n</page>\n\n<message>\n${instruction}\n</message>`,
    },
  ];

  for (let turn = 0; turn < 6; turn++) {
    const response = await anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      ...FALLBACK,
      system,
      output_config: { effort: "medium" },
      tools: [webSearch, EDIT_TOOL],
      messages,
    }).finalMessage();
    if (response.stop_reason === "refusal") throw new Error("Claude declined this change.");
    if (response.stop_reason === "max_tokens") throw new Error("That change was too long to make in one go. Try it a part at a time.");

    const call = response.content.find((b) => b.type === "tool_use" && b.name === "edit_page");
    if (call && call.type === "tool_use") {
      const input = call.input as { summary?: unknown; edits?: Edit[] };
      const { fields, problems } = applyEdits(op, Array.isArray(input.edits) ? input.edits : []);
      const summary = Array.isArray(input.summary) ? input.summary.filter((x): x is string => typeof x === "string") : [];
      if (problems.length) summary.push(`Check: some edits were skipped (${problems.slice(0, 3).join("; ")}).`);
      return { summary, operation: fields, newConsultants: [] };
    }

    messages.push({ role: "assistant", content: response.content });
    // A long web search pauses the turn; otherwise remind it to submit.
    if (response.stop_reason !== "pause_turn") messages.push({ role: "user", content: "Call edit_page now with your edits." });
  }
  throw new Error("Claude didn't finish the change.");
}

// ---------- Which operation a learning belongs to ----------

const Route = z.object({
  intent: z
    .enum(["change", "question"])
    .describe(
      "question: the surgeon is asking something and wants an answer, with nothing saved. change: anything to add to or change on a page: a tip, a step, a learning, a tidy-up, videos or links, or writing up a new operation.",
    ),
  relevant_operation_ids: z
    .array(z.string())
    .describe("For a question: ids of up to 4 existing operations whose pages help answer it (empty if none)."),
  operation_id: z
    .string()
    .nullable()
    .describe("For a change: the id of the existing operation to change, or null if it needs a new page."),
  new_operation_name: z
    .string()
    .nullable()
    .describe("For a change that needs a new page: its name as a surgeon would write it, e.g. 'Total Knee Replacement'. Otherwise null."),
  region: z
    .string()
    .nullable()
    .describe(
      "For a new page: Hip, Knee, Foot & ankle, Shoulder & elbow, Hand & wrist, Spine, Paeds or Skills & approaches (approaches, positioning, ex-fix, suturing, metalwork removal and other general skills). Trauma and elective go by body region.",
    ),
});

export async function routeLearning(text: string, ops: { id: string; name: string }[], context = "", current: { id: string; name: string } | null = null) {
  const response = await anthropic().messages.parse({
    model: HAIKU,
    max_tokens: 2000,
    system:
      "A T&O surgeon typed something to the assistant in their operations notebook. First decide whether it is a question to answer or a change to make to a page. Then pick which of their operations it is about. Match loosely: abbreviations (TKR, DHS, THR, ORIF), sides and implant names all point to the operation. If they are viewing a page and don't name another operation, it is about the page they are on ('this', 'here', 'add that' all mean that page). Only suggest a new page if they ask for one or nothing fits. For a question, list the operations whose pages help answer it, including the page they are on if it's relevant. Earlier conversation is given for follow-ups.",
    output_config: { effort: "low", format: zodOutputFormat(Route) },
    messages: [
      {
        role: "user",
        content: `<operations>\n${ops.map((o) => `${o.id}: ${o.name}`).join("\n") || "(none yet)"}\n</operations>\n\n${current ? `<viewing>\n${current.id}: ${current.name}\n</viewing>\n\n` : ""}${context ? `<earlier_conversation>\n${context}\n</earlier_conversation>\n\n` : ""}<message>\n${text}\n</message>`,
      },
    ],
  });
  const out = response.parsed_output;
  if (!out) throw new Error("Couldn't tell what this is about");
  const known = (id: string | null) => (id && ops.some((o) => o.id === id) ? id : null);
  return {
    intent: out.intent,
    relevantIds: out.relevant_operation_ids.filter((id) => known(id)).slice(0, 4),
    operationId: known(out.operation_id),
    newName: out.new_operation_name?.trim() || null,
    region: out.region?.trim() || null,
  };
}

// ---------- Answering a question across operations ----------

const ASK_SYSTEM = `You answer questions from a UK trauma & orthopaedic surgeon about operations, using their own operations notebook.

- The surgeon may be viewing one page (<viewing>); "this" means that operation.
- The <pages> are the surgeon's own notes for the relevant operations: steps, tips per kit, mode and consultant, videos, links and Q&A. Base the answer on them first, and say which operation a point comes from when that helps.
- If the notes don't cover it, say so briefly, then answer from your own knowledge, clearly marked as not from their notes. Search the web only when the answer needs a current source, a video or a link, and only use URLs from your search results.
- Be terse and practical, like a senior colleague in theatre. Short bullet points. British spelling. Markdown only for bullets, bold and links.
- You can't change pages in this reply. If they want something added, tell them to just ask (e.g. "add that to the page") and it will be drafted for them to accept.`;

// ---------- Cleaning up dictation ----------

/** Fix the speech model's mishearings of surgical terms, without changing anything else. */
export async function correctTranscript(text: string, vocab: string[]): Promise<string> {
  if (!text.trim()) return text;
  const response = await anthropic().messages.create({
    model: HAIKU,
    max_tokens: 8000,
    system: `You correct speech-to-text transcripts dictated by a UK trauma & orthopaedic surgeon after an operation.
Fix only words the speech model misheard: surgical, anatomical, implant, instrument, suture, drug and eponym names, and abbreviations (e.g. "mono creel" → "Monocryl", "ethel bond" / "ethbond" → "Ethibond", "vicar ill" → "Vicryl", "bristol" → "Bristow" when it's the instrument, "home man" → "Hohmann", "tea x a" → "TXA", "2 o vicryl" → "2-0 Vicryl", "k wire" → "K-wire"). Use the vocabulary list, which holds this surgeon's own words.
Keep everything else exactly as spoken: same words, order and meaning. Don't summarise, tidy, reword or add anything. Fix obvious punctuation only. British spelling.
Reply with the corrected transcript only.`,
    messages: [{ role: "user", content: `<vocabulary>\n${vocab.join(", ")}\n</vocabulary>\n\n<transcript>\n${text}\n</transcript>` }],
  });
  const out = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  // Guard against anything other than a corrected transcript coming back.
  return out && out.length > text.length * 0.6 && out.length < text.length * 1.6 ? out.replace(/^<transcript>\s*|\s*<\/transcript>$/g, "") : text;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function answerQuestion(history: ChatTurn[], pages: Operation[], allNames: string[], viewing: string | null = null): Promise<string> {
  const pagesText = pages.map((op) => `<page>\n${pageText(op)}\n</page>`).join("\n") || "(no relevant pages found)";
  const turns = history.slice(-10);
  const last = turns[turns.length - 1];
  const messages: BetaMessageParam[] = [
    ...turns.slice(0, -1).map((t) => ({ role: t.role, content: t.content })),
    {
      role: "user",
      content: `<all_operations>\n${allNames.join("\n")}\n</all_operations>\n\n${viewing ? `<viewing>${viewing}</viewing>\n\n` : ""}<pages>\n${pagesText}\n</pages>\n\n<question>\n${last.content}\n</question>`,
    },
  ];
  let answer = "";
  for (let turn = 0; turn < 4; turn++) {
    const response = await anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      ...FALLBACK,
      system: ASK_SYSTEM,
      output_config: { effort: "low" },
      tools: [webSearch],
      messages,
    }).finalMessage();
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
    const response = await anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      ...FALLBACK,
      system,
      output_config: { effort: "medium" },
      tools: [webSearch, NOTE_TOOL],
      messages,
    }).finalMessage();
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
