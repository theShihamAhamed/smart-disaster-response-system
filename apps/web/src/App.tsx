import {
  ReliefAllocationFeature,
  type ReliefAllocationFeatureProps,
} from "./features/relief-allocation/ReliefAllocationFeature";

export function App(props: ReliefAllocationFeatureProps) {
  return <ReliefAllocationFeature {...props} />;
}
