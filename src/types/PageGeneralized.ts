import { PoolGeneralized } from './PoolGeneralized';
import { RewardsToken } from './RewardsToken';
import { Seo } from './Seo';

export interface PageGeneralized {
  id: number;
  attributes: {
    title?: string;
    seo?: { data: Seo };
    description?: string;
    staking_period?: string;
    rewards_interval?: string;
    rewards_tokens: { data: RewardsToken[] };
    pool_generalizeds: { data: PoolGeneralized[] };
  }
}
