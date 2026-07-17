export type AdmissionRelease = () => void;

export interface NonQueuingAdmissionLimiter {
  tryAcquire: () => AdmissionRelease | undefined;
}

export function createNonQueuingAdmissionLimiter(
  maximum: number,
): NonQueuingAdmissionLimiter {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new RangeError("admission capacity must be a positive safe integer");
  }

  let active = 0;
  return {
    tryAcquire() {
      if (active >= maximum) {
        return undefined;
      }
      active += 1;
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        active -= 1;
      };
    },
  };
}
