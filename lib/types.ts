export type BlockType = "text" | "bullet" | "number" | "toggle" | "heading";

/**
 * One block of the steps, Notion-style. The steps are a flat list in reading order; depth nests a
 * block inside the nearest shallower block above it. A toggle at depth 0 is a part of the operation.
 * A kit, mode (technique) or consultant tag makes the block, and everything nested in it, show only
 * when that one is chosen.
 */
export type Block = {
  id: string;
  type: BlockType;
  text: string;
  depth: number;
  kit: string | null;
  technique: string | null;
  consultant: string | null;
};
export type Kit = { id: string; name: string; maker: string; url: string };
export type Technique = { id: string; name: string };
export type VideoGroup = "full" | "other";
export type Video = { id: string; title: string; url: string; source: string; note: string; group: VideoGroup };
export type Link = { id: string; title: string; url: string; source: string; note: string };
export type Question = { id: string; q: string; a: string };

export type Content = {
  kits: Kit[];
  techniques: Technique[];
  blocks: Block[];
  videos: Video[];
  links: Link[];
  questions: Question[];
};

export type Operation = {
  id: string;
  name: string;
  region: string;
  subtitle: string;
  content: Content;
  updatedAt: string;
};

export type OperationFields = Pick<Operation, "name" | "region" | "subtitle" | "content">;

export type Consultant = { id: string; name: string };

export type Filters = { kit: string; technique: string; consultant: string };

export type Proposal = { summary: string[]; operation: OperationFields; newConsultants: Consultant[] };
