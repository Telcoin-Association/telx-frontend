export interface User {
  id: number;
  attributes: {
    username: string;
    email: string;
    provider: string;
    confirmed: boolean;
    blocked: boolean;
  }
}
