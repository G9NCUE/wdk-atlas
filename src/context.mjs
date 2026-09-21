// One object per mounted Atlas, passed to every module that draws part of it. It starts with what
// the shell knows (the frame, the query, how to write the address) and each module adds what it
// provides, so a page asks for the helpers it needs by name and none of them is built twice.
export function use(ctx, factory) {
  if (ctx.made.has(factory)) return;
  ctx.made.add(factory);
  Object.assign(ctx, factory(ctx));
}
