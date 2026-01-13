const titleToSlug = (title: string) => {
  return (title || "").toLowerCase().replace("& ", "").replace("(", "").replace(")", "").replace(/\s/g, "-").replace("?", "").replace(":", "");
};

export default titleToSlug;
