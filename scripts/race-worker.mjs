import { Store } from "../dist/store.js";

const N = 25;
const store = new Store();
for (let i = 0; i < N; i++) {
  await store.mutate((d) => {
    d.facts.push({
      id: `${process.pid}-${i}`,
      text: `worker ${process.pid} item ${i}`,
      tags: [],
      agent: `w-${process.pid}`,
      ts: new Date().toISOString(),
    });
  });
}
console.log(JSON.stringify({ pid: process.pid, dir: store.dir, wrote: N }));
