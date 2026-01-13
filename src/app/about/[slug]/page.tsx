import React from 'react';
import AboutNavToggle from "@/components/about/AboutNavToggle";
import AboutAside from "@/components/about/AboutAside";
import AboutMain from "@/components/about/AboutMain";
import titleToSlug from "@/helpers/titleToSlug";
import { getAboutPages } from "@/lib/getAboutPages";
import Link from 'next/link';
import Image from "next/image"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const aboutPages = getAboutPages();
  const { slug } = await params;
  const selectedPage: any = aboutPages.find((page: any) => {
    const title = page?.attributes?.title;
    return title && titleToSlug(title) === slug;
  });

  const title = selectedPage?.attributes?.title || "About";
  const description =
    selectedPage?.attributes?.content?.slice(0, 160) ||
    `Read more about ${title} on TELx Network.`;

  return {
    title: `${title} – About | TELx Network`,
    description,
    openGraph: {
      title: `${title} – TELx Network`,
      description,
      url: `https://telx.network/about/${slug}`,
      siteName: "TELx Network",
      images: [
        {
          url: "https://telx.network/images/og-about.png",
          width: 1200,
          height: 630,
          alt: `${title} – TELx Network`,
        },
      ],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} – TELx Network`,
      description,
      images: ["https://telx.network/images/og-about.png"],
    },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const aboutPages = getAboutPages().sort(
    (a: any, b: any) => a.attributes.order - b.attributes.order
  );

  const selectedPage: any = aboutPages.find((page: any) => {
    const title = page?.attributes?.title;
    return title && titleToSlug(title) === slug;
  });

  const categories = Array.from(
    new Set(
      aboutPages.map((page: any) => page.attributes.category).filter(Boolean)
    )
  );

  const sideMenuItems = aboutPages.map((page: any) => ({
    title: page.attributes.title || "",
    category: page.attributes.category || "",
    slug: titleToSlug(page.attributes.title),
    categoryIndex: categories.indexOf(page.attributes.category),
  }));

  const organizedSideMenu: any = categories.map((category) => ({
    category,
    items: sideMenuItems.filter((item: any) => item.category === category),
  }));

  return (
    <div className="relative max-w-7xl mx-auto min-h-[calc(100vh-80px)]">
      <div className="flex items-start">
        <div className="w-[25%] hidden lg:flex flex-col gap-12 px-4 xl:px-0 self-start sticky top-20 pt-12 lg:py-12">
          <div className=" flex gap-2 w-fit px-4 xl:px-0">
            <Link href={'#'} className=" text-primary text-sm">About</Link>
            <Image src={'/icons/breadCrumb.svg'} alt={''} width={6} height={6} style={{ height: "auto", width: "auto" }} /> <p className='text-white text-sm'>{selectedPage?.attributes.title}</p>
          </div>
          {organizedSideMenu?.map((item: any, i: number) => {
            return (
              <div key={i}>
                <h4 className=" text-primary mb-2 text-sm">{item?.category} </h4>
                {
                  item.items.map((item: any, i: number) => {
                    const { title, slug } = item;
                    return (
                      <Link key={i} href={`/about/${titleToSlug(slug)}`} className="flex items-center gap-2 -ml-4">
                        <div className={`bg-white h-2 w-2 rounded-full ${selectedPage?.attributes.title === title ? "opacity-100" : "opacity-0"}`} />
                        <p className={`py-[1px] text-sm hover:text-white  ${selectedPage?.attributes.title === title ? "text-white" : "text-tblue-800"} `}> {item.title}</p>
                      </Link>
                    )
                  })
                }
              </div>
            )
          })}
        </div>
        <main className="w-full lg:w-[75%]">
          <AboutMain
            organizedSideMenu={organizedSideMenu}
            selectedEntry={selectedPage}
          />
          <AboutNavToggle
            text="About"
            aside={
              <>
                <AboutAside
                  organizedSideMenu={organizedSideMenu}
                  selectedEntry={selectedPage}
                />
              </>
            }
          />
        </main>
      </div>
    </div>
  );
}

// Generate static paths for all about entries
export async function generateStaticParams() {
  const aboutPages = getAboutPages();

  return aboutPages.map((page: any) => ({
    slug: titleToSlug(page.attributes.title),
  }));
}
