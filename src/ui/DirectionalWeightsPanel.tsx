import { useWorkspaceStore } from '../state';
import type { DirectionalWeight } from '../types';

export const DirectionalWeightsPanel = () => {
  const weights = useWorkspaceStore((state) => state.oxidationDefaults.directionalWeights);
  const addWeight = useWorkspaceStore((state) => state.addDirectionalWeight);

  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="section-title">Directional Weights</div>
      <div className="flex flex-col gap-3">
        {weights.map((weight) => (
          <WeightEditor key={weight.id} weight={weight} />
        ))}
      </div>
      <button className="button-primary" onClick={addWeight}>
        Add Weight
      </button>
    </div>
  );
};

interface WeightEditorProps {
  weight: DirectionalWeight;
}

const WeightEditor = ({ weight }: WeightEditorProps) => {
  const updateWeight = useWorkspaceStore((state) => state.updateDirectionalWeight);
  const removeWeight = useWorkspaceStore((state) => state.removeDirectionalWeight);

  return (
    <div className="flex items-center gap-2 rounded-lg bg-accentSoft/60 p-2">
      <div className="flex flex-col gap-1 text-xs text-muted">
        <label>
          <span className="font-medium">Angle</span>
          <input
            type="number"
            value={weight.angle}
            onChange={(e) => updateWeight(weight.id, { angle: Number(e.target.value) })}
            className="w-full rounded-md border-border bg-white p-1 text-center text-text"
            step={5}
          />
        </label>
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted">
        <label>
          <span className="font-medium">Strength</span>
          <input
            type="number"
            value={weight.strength}
            onChange={(e) => updateWeight(weight.id, { strength: Number(e.target.value) })}
            className="w-full rounded-md border-border bg-white p-1 text-center text-text"
            step={0.5}
          />
        </label>
      </div>
      <button
        className="ml-auto h-8 w-8 rounded-md text-muted hover:bg-accentSoft"
        onClick={() => removeWeight(weight.id)}
        aria-label="Remove weight"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="m-auto"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
};
