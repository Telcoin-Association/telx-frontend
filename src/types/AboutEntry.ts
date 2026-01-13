export interface AboutEntry {
  id: number;
  attributes: {
    category?: string;
    order?: number;
    title?: string;
    content?: string;
  };
}
