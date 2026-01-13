import { Media } from './Media';

export interface Affiliate {
  id: number;
  attributes: {
    name?: string;
    logo?: { data: Media[] };
    link?: string;
  }
}
