import { ContentBlock } from './ContentBlock';
import { Affiliate } from './Affiliate';
import { Seo } from './Seo';

export interface PageHome {
  id: number;
  attributes: {
    seo?: { data: Seo };
    title?: string;
    affiliates: { data: Affiliate[] };
    hero?: { data: ContentBlock };
    overview?: { data: ContentBlock };
    how_it_works?: { data: ContentBlock };
    phases: { data: ContentBlock[] };
    about_products?: { data: ContentBlock };
    products: { data: ContentBlock[] };
  }
}
