import React from "react";
import Link from "next/link";

interface PoolsNavProps {
  path?: string;
  productName?: string;
  slug: string;
}

const PoolsNav = (props: PoolsNavProps) => {
  const { slug, path, productName } = props;

  const menuItems = [
    {
      link: `/${slug}`,
      text: `${productName} Pools`,
      className: "",
    },
    {
      link: `/${slug}/rewards`,
      text: "Rewards",
      className: "",
    },
    {
      link: `/${slug}/archive`,
      text: "Archive",
      className: "",
    },
  ];

  return (
    <div className="bg-ocean-gradient-dark opacity-90">
      <ul className="px-5 flex text-center space-x-5 md:space-x-8 max-w-xl mx-auto xl:max-w-6xl md:flex ">
        {menuItems.map(item => {
          const isActive = path === item.link;
          return (
            <li key={item.link} className={`font-bold text-base hover:text-white-100 py-4 ${isActive ? "text-white-100" : "text-white-50 "}`}>
              <Link href={item.link}>{item.text}</Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PoolsNav;
