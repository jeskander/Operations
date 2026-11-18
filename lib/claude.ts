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
        type: { type: "string", enum: ["toggle", "heading", "bullet", "number", "text"] },
        text: { type: "string", description: "Short. **bold** and *italic* allowed." },
        depth: { type: "integer", description: "Nesting: 0 at the top, or at most one more than the block above it." },
        kit: { ...sOrNull, description: "A kit id if this block (and everything nested in it) applies only to that kit" },
        technique: { ...sOrNull, description: "A technique (mode) id if only for that technique" },
        consultant: { ...sOrNull, description: "A consultant id if only for that consultant" },
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

export async function proposeEdit(op: Operation, consultants: Consultant[], instruction: string): Promise<Proposal> {
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
      system: SYSTEM,
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
  operation_id: z.string().nullable().describe("The id of the existing operation this is about, or null if none fits."),
  new_operation_name: z
    .string()
    .nullable()
    .describe("If no existing operation fits, the name for a new one as a surgeon would write it, e.g. 'Total Knee Replacement'. Otherwise null."),
  region: z.string().nullable().describe("For a new operation: Hip, Knee, Foot & ankle, Shoulder & elbow, Hand & wrist, Spine, Paeds, Trauma or General."),
});

export async function routeLearning(text: string, ops: { id: string; name: string }[]) {
  const response = await anthropic().messages.parse({
    model: HAIKU,
    max_tokens: 2000,
    system:
      "A T&O surgeon typed a note about an operation. Pick which of their existing operations it belongs to. Match loosely: abbreviations (TKR, DHS, THR, ORIF), sides and implant names all point to the operation. Only suggest a new operation if none fits.",
    output_config: { effort: "low", format: zodOutputFormat(Route) },
    messages: [
      {
        role: "user",
        content: `<operations>\n${ops.map((o) => `${o.id}: ${o.name}`).join("\n") || "(none yet)"}\n</operations>\n\n<note>\n${text}\n</note>`,
      },
    ],
  });
  const out = response.parsed_output;
  if (!out) throw new Error("Couldn't tell which operation this is about");
  return {
    operationId: out.operation_id && ops.some((o) => o.id === out.operation_id) ? out.operation_id : null,
    newName: out.new_operation_name?.trim() || null,
    region: out.region?.trim() || null,
  };
}
