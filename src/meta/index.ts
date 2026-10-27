/**
 * src/meta (§6.2, TECH-10): the collection, upgrades, chests, trophies, quests and the card
 * shop — pure TypeScript without the engine, the browser or the platform, tested in Node.
 * Time (the server clock) and randomness (seeded) are passed in. The menu shows it in Stage 3.
 */

export * from './save-data';
export * from './collection';
export * from './chests';
export * from './trophies';
export * from './quests';
export * from './shop';
