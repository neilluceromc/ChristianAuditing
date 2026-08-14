import { clsx, type ClassValue } from "clsx";

/** Join class names; false/undefined values drop out. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
