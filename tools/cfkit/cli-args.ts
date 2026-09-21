export function flagValue(
  args: readonly string[],
  flag: string,
): string | undefined {
  const index = args.indexOf(flag);

  return index === -1 ? undefined : args[index + 1];
}
