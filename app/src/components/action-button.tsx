import { Pressable, Text } from 'react-native';

import { cn } from '@/lib/utils/cn';

export function ActionButton({ label, variant = 'primary', disabled = false, onPress }: Props) {
  return (
    <Pressable
      className={cn(
        'h-11 items-center justify-center border px-4',
        disabled ? 'border-gray-200 bg-gray-100' : variantClass[variant]
      )}
      disabled={disabled}
      onPress={onPress}>
      <Text
        className={cn('text-sm font-semibold', disabled ? 'text-gray-400' : textClass[variant])}>
        {label}
      </Text>
    </Pressable>
  );
}

type Variant = 'primary' | 'secondary';

type Props = {
  label: string;
  variant?: Variant;
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
