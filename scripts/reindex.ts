import { clearArticleIndex, getDb } from "../src/db.js";
import { iterArticles } from "../src/storage/articles.js";
import { indexArticle } from "../src/storage/index-db.js";

/**
 * Rebuild the SQLite article index from the Markdown files (source of truth).
 * Safe to run any time; keys/types are preserved (SPEC §5).
 */
function main() {
  const db = getDb();
  clearArticleIndex(db);
  let n = 0;
  for (const article of iterArticles()) {
    indexArticle(article, db);
    n += 1;
  }
  console.log(`reindexed ${n} article(s) into ${db.name}`);
}

main();
