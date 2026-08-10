export type Tone = 'neutral' | 'safe' | 'caution' | 'danger';

export const toneTextClass: Record<Tone, string> = {
  neutral: 'text-gray-950',
  safe: 'text-emerald-700',
  caution: 'text-amber-700',
  danger: 'text-red-700',
};

export const toneDotClass: Record<Tone, string> = {
  neutral: 'bg-gray-300',
  safe: 'bg-emerald-500',
  caution: 'bg-amber-500',
  danger: 'bg-red-500',
};
