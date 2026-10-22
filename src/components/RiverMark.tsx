import riverUrl from "../../src-tauri/icons/Garam.icon/Assets/river.png";

/** Garam's mark, taken from the artwork the app icon is built from. */
export function RiverMark({ size = 64 }: { size?: number }) {
  return <img src={riverUrl} width={size} height={size} alt="" draggable={false} />;
}
