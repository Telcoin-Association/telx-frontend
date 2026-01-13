"use client";

import React from "react";
import GeneralizedPools from "@/components/generalized/GeneralizedPools";
import CardSearchAbout from "@/components/search/CardSearchAbout";
import ArchiveCards from "@/components/archive/ArchiveCards";
import {
  contractsSelector,
  deprecatedContractsListSelector,
  deprecatedPoolsListSelector,
} from "@/redux/slices/contractsSlice";
import { PageGeneralized as PageGeneralisedProps } from "@/types/PageGeneralized";
import { documentToHtmlString } from "@/components/common/ContentfulRichText";
import { AboutEntry as AboutEntryProps } from "@/types/AboutEntry";
import { useMemo, useState, useCallback, useEffect } from "react";
import { Search as SearchIcon } from "@transferwise/icons";
import { useAppSelector } from "@/redux/hooks";
import { useRouter } from "next/navigation";
import defaultRewards from "@/data/defaultRewards.json"
import pageGeneralized from "@/data/pageGeneralized.json"
import SearchPoolsCards from "@/components/search/SearchPoolsCards";

interface AboutPageData {
  category: string;
  content: string;
  title: string;
  order: number;
}

export default function PageSearch({
  initialSearchQuery = "",
  aboutPagesData,
}: {
  initialSearchQuery: string;
  aboutPagesData: {
    id: number
    attributes: AboutPageData
  }[]
}) {
  const [searchQuery, setSearchQuery] = useState<string>(
    initialSearchQuery || ""
  );
  const [hasSearched, setHasSearched] = useState(!!initialSearchQuery);
  const [confirmedSearchQuery, setConfirmedSearchQuery] = useState<string>(
    initialSearchQuery || ""
  );
  const [rewardAttributes, setRewardAttributes] = useState<any>();
  const [aboutEntries, setAboutEntries] = useState<AboutEntryProps[]>([]);
  const [generalizedPage, setGeneralizedPage] =
    useState<PageGeneralisedProps>();
  const router = useRouter();

  const handleSearchChange = useCallback((event: any) => {
    setSearchQuery(event.target.value);
  }, []);

  // Update handleSearchSubmit to use the current state
  const handleSearchSubmit = useCallback(
    (event: React.KeyboardEvent) => {
      if (event?.key === "Enter") {
        setConfirmedSearchQuery(searchQuery);
        router.push(`/search?s=${encodeURIComponent(searchQuery)}`);
        setHasSearched(true);
      }
    },
    [searchQuery, router]
  );

  const generalizedPageAttributes = generalizedPage?.attributes;
  const generalisedContracts =
    generalizedPageAttributes?.pool_generalizeds.data;

  const contracts = useAppSelector(contractsSelector);

  const archivePoolsList = useAppSelector(deprecatedPoolsListSelector);
  const archiveContractList = useAppSelector(deprecatedContractsListSelector);

  const archivePoolsListFiltered = Object.values(archivePoolsList);
  const archiveContractListFiltered = Object.values(archiveContractList);

  const archiveList = useMemo(() => {
    return [...archiveContractListFiltered, ...archivePoolsListFiltered];
  }, [archiveContractListFiltered, archivePoolsListFiltered]);

  const lcQuery = confirmedSearchQuery?.toLowerCase();

  const showGIHeader = useMemo(() => {
    if (lcQuery) {
      const { description, title } = generalizedPage?.attributes || {};

      const match = {
        title: false,
        description: false,
      };
      if (description) {
        match.description = description.toLowerCase().includes(lcQuery);
      }

      if (title) {
        match.title = title.toLowerCase().includes(lcQuery);
      }
      return Object.values(match).some((val) => val === true);
    }

    return false;
  }, [generalizedPage, lcQuery]);

  const filteredGIContracts = useMemo(() => {
    if (lcQuery) {
      const contracts: any = generalisedContracts;

      return contracts?.filter((contract: any) => {
        const match = {
          poolAddress: false,
          asset1Ticker: false,
          asset2Ticker: false,
          linkAddLiquidity: false,
        };

        const {
          pool_address: poolAddress,
          link_add_liquidity: linkAddLiquidity,
        } = contract.attributes;
        const poolAssets = contract.attributes.pool_assets;

        const poolAsset1Ticker = poolAssets.data[0]?.attributes?.name;
        const poolAsset2Ticker = poolAssets.data[1]?.attributes?.name;

        if (poolAddress) {
          match.poolAddress = poolAddress.toLowerCase().includes(lcQuery);
        }
        if (poolAsset1Ticker) {
          match.asset1Ticker = poolAsset1Ticker.toLowerCase().includes(lcQuery);
        }
        if (poolAsset2Ticker) {
          match.asset2Ticker = poolAsset2Ticker.toLowerCase().includes(lcQuery);
        }
        if (linkAddLiquidity) {
          match.linkAddLiquidity = linkAddLiquidity
            .toLowerCase()
            .includes(lcQuery);
        }
        return Object.values(match).some((val) => val === true);
      });
    }

    return [];
  }, [generalisedContracts, lcQuery]);
  const filteredGeneralizedIncentivesPage = {
    ...generalizedPageAttributes,
    contracts: filteredGIContracts,
  };

  const filteredPools = useMemo(() => {
    if (lcQuery) {
      return Object.values(contracts).filter((contract) => {
        const match = {
          activeStakingAddress: false,
          name: false,
          deprecatedStakingAddress: false,
          poolContractAddress: false,
          assets: false,
          protocol: false,
          blockchain: false,
        };
        if (
          contract.activeStakingAddress &&
          contract.activeStakingAddress.address
        ) {
          const activeStakingAddress = documentToHtmlString(
            contract.activeStakingAddress.address
          ).toLowerCase();
          match.activeStakingAddress = activeStakingAddress.includes(lcQuery);
        }
        if (contract.name) {
          const name = contract.name.toLowerCase();
          match.name = name.includes(lcQuery);
        }
        if (contract.deprecatedStakingAddresses) {
          const deprecatedStakingAddresses =
            contract.deprecatedStakingAddresses;
          match.deprecatedStakingAddress = deprecatedStakingAddresses.some(
            (dsa) => dsa.address.toLowerCase().includes(lcQuery)
          );
        }
        if (contract.poolContractAddress) {
          const poolContractAddress =
            contract.poolContractAddress.toLowerCase();
          match.poolContractAddress = poolContractAddress.includes(lcQuery);
        }
        if (contract.assets) {
          const assets = contract.assets;
          match.assets = assets.some((asset: any) =>
            asset.ticker.toLowerCase().includes(lcQuery)
          );
        }
        if (contract.protocol) {
          const protocol = contract.protocol.toLowerCase();
          match.protocol = protocol.includes(lcQuery);
        }
        if (contract.blockchain) {
          const blockchain = contract.blockchain.toLowerCase();
          match.blockchain = blockchain.includes(lcQuery);
        }
        return Object.values(match).some((val) => val === true);
      });
    }

    return [];
  }, [contracts, lcQuery]);

  const filteredAboutEntries = useMemo(() => {
    if (lcQuery) {
      return aboutEntries.filter((entry) => {
        const match = {
          content: false,
          title: false,
        };
        if (entry?.attributes?.title) {
          const title = entry.attributes.title.toLowerCase();
          match.title = title.includes(lcQuery);
        }
        if (entry?.attributes?.content) {
          const content = documentToHtmlString(
            entry?.attributes?.content
          ).toLowerCase();
          match.content = content.includes(lcQuery);
        }
        return Object.values(match).some((val) => val === true);
      });
    }

    return [];
  }, [aboutEntries, lcQuery]);

  const filteredArchivePools = useMemo(() => {
    if (lcQuery) {
      return Object.values(archiveList).filter((contract) => {
        const match = {
          activeStakingAddress: false,
          name: false,
          deprecatedStakingAddress: false,
          poolContractAddress: false,
          assets: false,
          protocol: false,
          blockchain: false,
        };
        if (
          contract.activeStakingAddress &&
          contract.activeStakingAddress.address
        ) {
          const activeStakingAddress =
            contract.activeStakingAddress.address.toLowerCase();
          match.activeStakingAddress = activeStakingAddress.includes(lcQuery);
        }
        if (contract.name) {
          const name = contract.name.toLowerCase();
          match.name = name.includes(lcQuery);
        }
        if (contract.deprecatedStakingAddresses) {
          const deprecatedStakingAddresses =
            contract.deprecatedStakingAddresses;
          match.deprecatedStakingAddress = deprecatedStakingAddresses.some(
            (dsa) => dsa.address.toLowerCase().includes(lcQuery)
          );
        }
        if (contract.poolContractAddress) {
          const poolContractAddress =
            contract.poolContractAddress.toLowerCase();
          match.poolContractAddress = poolContractAddress.includes(lcQuery);
        }
        if (contract.assets) {
          const assets = contract.assets;
          match.assets = assets.some((asset: any) =>
            asset.ticker.toLowerCase().includes(lcQuery)
          );
        }
        if (contract.protocol) {
          const protocol = contract.protocol.toLowerCase();
          match.protocol = protocol.includes(lcQuery);
        }
        if (contract.blockchain) {
          const blockchain = contract.blockchain.toLowerCase();
          match.blockchain = blockchain.includes(lcQuery);
        }
        return Object.values(match).some((val) => val === true);
      });
    }

    return [];
  }, [lcQuery, archiveList]);

  useEffect(() => {
    if (initialSearchQuery) {
      setConfirmedSearchQuery(initialSearchQuery);
      setHasSearched(true);
    }
  }, [initialSearchQuery]);

  const SearchResultsContainer = ({
    title,
    results,
  }: {
    title: string;
    results: any;
  }) => {
    return (
      <div className="px-2 xl:px-0 w-full overflow-x-auto">
        <h3 className="text-white-100 font-base my-2 text-center mb-5 font-bold text-2xl">
          {title}
        </h3>
        <div className="mx-auto grid gap-2 xl:gap-0 ">{results}</div>
      </div>
    );
  };

  useEffect(() => {
    const fetchData = async () => {
      if (aboutPagesData) {
        setAboutEntries(aboutPagesData);
      }
      if (pageGeneralized) {
        setGeneralizedPage(pageGeneralized);
      }
      if (defaultRewards) {
        setRewardAttributes(defaultRewards[0]?.attributes);
      }
    };

    fetchData();
  }, [aboutPagesData]);

  return (
    <div className="flex flex-col mt-4">
      <div className="w-full flex flex-col justify-center max-w-7xl mx-auto ">
        <div className="lg:mx-auto mx-4 md:mx-24">
          <div className="flex items-center text-gray-800 lg:w-[32rem] h-14 my-auto mt-4 lg:mx-0 rounded-xl border-blue-700 border-[1px]">
            <div className="pl-4 text-blue-700">
              <SearchIcon size={24} />
            </div>
            <input
              type="text"
              placeholder="Search assets, tickers, addresses, articles...."
              onChange={handleSearchChange}
              value={searchQuery ? searchQuery : ""}
              className={
                "w-full h-full text-base font-normal text-white placeholder-gray-600 px-3 rounded-xl border-none outline-none"
              }
              suppressHydrationWarning
              onKeyDown={handleSearchSubmit}
            />
          </div>
          <div className="text-center">
            {(showGIHeader ||
              filteredGIContracts?.length > 0 ||
              filteredPools?.length > 0 ||
              filteredAboutEntries?.length > 0 ||
              filteredArchivePools?.length > 0) && (
                <h1 className="text-white-100 text-base my-4">
                  Search Results
                </h1>
              )}
          </div>
        </div>
        <div className="mt-5 min-h-[80vh]">
          {/* Pools results */}
          {filteredPools?.length > 0 && (
            <SearchResultsContainer
              title="Pools"
              results={
                <div className="w-full overflow-x-auto">
                  <div className="rounded-2xl border border-white/10 shadow-2xl ">
                    <SearchPoolsCards
                      contractsData={filteredPools}
                      defaultRewards={rewardAttributes}
                    />
                  </div>
                </div>
              }
            />
          )}

          {/* Archive results */}
          {filteredArchivePools?.length > 0 && (
            <SearchResultsContainer
              title="Archive"
              results={
                <div className="w-full overflow-x-auto">
                  <div className="rounded-2xl border border-white/10 shadow-2xl ">
                    <ArchiveCards
                      contractsData={filteredArchivePools}
                      endListText={false}
                      displayLabels={false}
                    />
                  </div>
                </div>
              }
            />
          )}

          {/* Generalized Incentives results */}
          {(showGIHeader || filteredGIContracts?.length > 0) && (
            <SearchResultsContainer
              title="Generalized Incentives"
              results={
                (showGIHeader || filteredGIContracts?.length > 0) && (
                  <GeneralizedPools
                    contracts={filteredGeneralizedIncentivesPage.contracts}
                  />
                )
              }
            />
          )}

          {/* About page results */}
          {filteredAboutEntries?.length > 0 && confirmedSearchQuery && (
            <SearchResultsContainer
              title="About Articles"
              results={filteredAboutEntries.map((entry, idx) => (
                <div key={`about-${idx}`}>
                  <CardSearchAbout
                    key={`aboutCard-${idx}`}
                    aboutEntry={entry}
                    query={confirmedSearchQuery}
                  />
                </div>
              ))}
            />
          )}

          {!hasSearched &&
            !showGIHeader &&
            filteredGIContracts?.length === 0 &&
            filteredPools?.length === 0 && (
              <p className="text-center my-12 text-white-100 min-h-[80vh]"></p>
            )}
          {showGIHeader ||
            filteredGIContracts?.length > 0 ||
            filteredPools?.length > 0 ||
            filteredAboutEntries?.length > 0 ? (
            <p className="text-center my-12 text-white-100">
              End of Search Results
            </p>
          ) : hasSearched ? (
            <p className="text-center my-12 text-white-100 min-h-[80vh]">
              We couldn’t find anything related to your search. Please try
              again.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
