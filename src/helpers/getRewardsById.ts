type TokenData = {
    amount: number;
    image: string;
    name: string;
    ticker: string;
    unclaimed: number;
    weeklyUser: number;
  };
  
  export function getTokenDataById(id: string): TokenData[] {
    const tokens: Record<string, TokenData[]> = {
      "0xb6d004fca4f9a34197862176485c45ceab7117c86f07422d1fe3d9cfd6e9d1da": [{
        amount: 648148,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }],
      "0xfd56605f7f4620ab44dfc0860d70b9bd1d1f648a5a74558491b39e816a10b99a": [{
        amount: 560000,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }],
      "0x9a005a0c12cc2ef01b34e9a7f3fb91a0e6304d377b5479bd3f08f8c29cdf5deb": [{
        amount: 648148,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }],
      "0x29f94ec9b66df7fe4068e2d7e9bf0147b49afcdc7cd3283dff03088b8026169f": [{
        amount: 560000,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }],
      "0x727b2741ac2b2df8bc9185e1de972661519fc07b156057eeed9b07c50e08829b": [{
        amount: 648148,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }],
      "0x25412ca33f9a2069f0520708da3f70a7843374dd46dc1c7e62f6d5002f5f9fa7": [{
        amount: 648148,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }],
      "0xd6771c30706f7933f3b1b1ac83f2f82c58673f556157e0414b1968702a5088d0": [{
        amount: 2777777.78,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }],
      "0x272e0968e2fb347236c6060cc9395f13591968f3f83056c600c755066dd214a6": [{
        amount: 2777777.78,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }],
      "0x1266df876a41a4f4250dbfa9887e70f20a40a3ccd802c8d75b51b7fd4eb36982": [{
        amount: 2777777.78,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }],
      "0xa22a3fb3ab8f44db2692b0a810bc98e9459c8e746d08cdf09afe31a08830de0d": [{
        amount: 2777777.78,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }],
      "0xe604df8f20f2fa4851df502d4faf470a6fa1bf5b5e1236e1de14690eaeb7a135": [{
        amount: 2777777.78,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }],
    };

    const defaultToken: TokenData[] = [{
        amount: 694444.5,
        image: "https://assets.coingecko.com/coins/images/1899/small/tel.png?1547036203",
        name: "Telcoin",
        ticker: "TEL",
        unclaimed: 0,
        weeklyUser: 0
      }];
  
      return tokens[id] ?? defaultToken;
  }
  