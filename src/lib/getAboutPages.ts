import fs from "fs";
import path from "path";
import matter from "gray-matter";

const aboutDir = path.join(process.cwd(), "content/about");

export function getAboutPages() {
    const files = fs.readdirSync(aboutDir);

    return files.map((file) => {
        const filePath = path.join(aboutDir, file);
        const fileContent = fs.readFileSync(filePath, "utf-8");

        const { data, content } = matter(fileContent);

        return {
            id: data.id,
            attributes: {
                category: data.category,
                order: data.order,
                title: data.title,
                content, // markdown body
            },
        };
    });
}
