import { AsyncLocalStorage } from "node:async_hooks";

const stateMutationContext = new AsyncLocalStorage();

export const NO_STATE_CHANGE = Symbol("NO_STATE_CHANGE");

export function runStateMutation(mutator) {
  return stateMutationContext.run({ active: true }, mutator);
}

export function stateMutationIsActive() {
  return Boolean(stateMutationContext.getStore()?.active);
}

export function assertOutboundAllowed(service) {
  if (stateMutationIsActive()) {
    throw new Error(`${service} network I/O is not allowed inside a state mutation.`);
  }
}
