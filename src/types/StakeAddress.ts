
export interface StakeAddress {
  id: number;
  attributes: {
    address?: string;
    active?: boolean;
    start_date?: Date;
    end_date?: Date;
    pool?: string;
  }
}
