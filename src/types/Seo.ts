import { Media } from "./Media";

export interface Seo {
  id?: number;
  attributes?: {
    title?: string;
    url?: string;
    siteName?: string;
    description?: string;
    image?: { data: Media[] | null };
  };
}
