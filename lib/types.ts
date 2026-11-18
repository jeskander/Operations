export type ListStyle = "bullet" | "number";

/** One line in a step. A kit, technique or consultant makes it show only when that one is chosen. */
export type Item = {
  id: string;
  text: string;
  list: ListStyle;
  depth: number; // 0–2
  kit: string | null;
  technique: string | null;
  consultant: string | null;
};

/** A part of the operation. depth 1 makes it a sub-part of the part above. */
export type Section = { id: string; title: string; depth: number; items: Item[] };
export type Kit = { id: string; name: string; maker: string; url: string };
export type Technique = { id: string; name: string };
export type VideoGroup = "full" | "other";
export type Video = { id: string; title: string; url: string; source: string; note: string; group: VideoGroup };
export type Link = { id: string; title: string; url: string; source: string; note: string };
export type Question = { id: string; q: string; a: string };

export type Content = {
  kits: Kit[];
  techniques: Technique[];
  sections: Section[];
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
