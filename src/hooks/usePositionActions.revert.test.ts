/**
 * @jest-environment node
 */
import { ContractFunctionRevertedError, encodeErrorResult, type Hex } from "viem";
import { positionManagerAbi, revertReason } from "./usePositionActions";

/**
 * The revert the Polygon PositionManager returned on 2026-10-01 for subscribe(143538, Merkl subscriber, 0x) on an
 * out-of-range WETH/TEL position: WrappedError(target = Merkl subscriber, selector = notifySubscribe,
 * reason = OutOfRange(143538), details).
 */
const POLYGON_OUT_OF_RANGE_REVERT: Hex =
  "0x90bfb86500000000000000000000000019edfa380ead0bb26010ca3d1c7abc7213938c868d57f6b2000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000246f2fb69e00000000000000000000000000000000000000000000000000000000000230b200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000481ea5e9e00000000000000000000000000000000000000000000000000000000";

const reverted = (data: Hex) => new ContractFunctionRevertedError({ abi: positionManagerAbi, data, functionName: "subscribe" });

describe("revertReason for a subscribe the Merkl subscriber rejects", () => {
  it("names an out-of-range position from the revert the live contract returns", () => {
    const error = reverted(POLYGON_OUT_OF_RANGE_REVERT);
    expect(error.data?.errorName).toBe("WrappedError");
    expect(revertReason(error)).toBe("Only in-range positions can be subscribed. This one is out of range.");
  });

  it("still matches OutOfRange() without the token id, and the older SubscriptionReverted wrapper", () => {
    const subscriber = "0x19EDFa380ead0Bb26010Ca3d1C7AbC7213938c86";
    const older = encodeErrorResult({ abi: positionManagerAbi, errorName: "SubscriptionReverted", args: [subscriber, "0x7db3aba7"] });
    expect(revertReason(reverted(older))).toBe("Only in-range positions can be subscribed. This one is out of range.");
  });

  it("says the subscriber rejected the position for any other reason", () => {
    const subscriber = "0x19EDFa380ead0Bb26010Ca3d1C7AbC7213938c86";
    const other = encodeErrorResult({
      abi: positionManagerAbi,
      errorName: "WrappedError",
      args: [subscriber, "0x8d57f6b2", "0xdeadbeef", "0x"],
    });
    expect(revertReason(reverted(other))).toBe("The rewards subscriber rejected this position.");
  });
});
