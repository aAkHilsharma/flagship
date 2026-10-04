import { Check } from 'lucide-react';

export function FlagSteps({ targeting = false }: { targeting?: boolean }) {
  return (
    <div className="creation-steps">
      <span className={targeting ? 'step done' : 'step active'}>
        {targeting ? <Check size={17} /> : '1'}
      </span>
      <strong>Flag details</strong>
      <i />
      <span className={targeting ? 'step active' : 'step'}>2</span>
      <span>Targeting rules</span>
    </div>
  );
}
