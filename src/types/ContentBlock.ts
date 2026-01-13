import { Media } from './Media';

export interface ContentBlock {
  id: number;
  attributes: {
    title?: string;
    description?: string;
    image?: { data: Media[] };
    cta_text?: string;
    cta_url?: string;
    cta_external?: boolean;
  }
}
