import { Media } from "./Media";

export interface Notice {
  id: number;
  attributes: {
    title?: string;
    description?: string;
    image?: { data: Media[] | null };
    notice_id?: string;
  };
}
