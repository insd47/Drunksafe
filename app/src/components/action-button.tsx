import { ActivityIndicator, Pressable, Text } from 'react-native';

import { cn } from '@/lib/utils/cn';

export function ActionButton({
  label,
  variant = 'primary',
  size = 'md',
  busy = false,
  disabled = false,
  onPress,
}: Props) {
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      className={cn(
        'flex-row items-center justify-center gap-2 border px-4',
        sizeClass[size],
        inactive ? 'border-gray-200 bg-gray-100' : variantClass[variant]
      )}
      disabled={inactive}
      onPress={onPress}>
      {busy ? <ActivityIndicator color="#9ca3af" size="small" /> : null}
      <Text
        numberOfLines={2}
        adjustsFontSizeToFit
        className={cn(
          'flex-shrink text-center font-semibold',
          labelSizeClass[size],
          inactive ? 'text-gray-400' : textClass[variant]
        )}>
        {label}
      </Text>
    </Pressable>
  );
}

type Variant = 'primary' | 'secondary';

type Size = 'md' | 'lg';

type Props = {
  label: string;
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

const variantClass: Record<Variant, string> = {
  primary: 'border-gray-950 bg-gray-950',
  secondary: 'border-gray-300 bg-white',
};

const textClass: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-gray-950',
};

const sizeClass: Record<Size, string> = {
  md: 'h-11',
  lg: 'h-14',
};

const labelSizeClass: Record<Size, string> = {
  md: 'text-sm',
  lg: 'text-base',
};
