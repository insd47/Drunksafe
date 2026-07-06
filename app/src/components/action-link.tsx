import { Link, type Href } from 'expo-router';
import { Text, Pressable } from 'react-native';

import { cn } from '@/lib/utils/cn';

export function ActionLink({ href, label, variant = 'primary' }: Props) {
  return (
    <Link href={href} asChild>
      <Pressable
        className={cn('h-11 items-center justify-center border px-4', variantClass[variant])}>
        <Text className={cn('text-sm font-semibold', textClass[variant])}>{label}</Text>
      </Pressable>
    </Link>
  );
}

type Variant = 'primary' | 'secondary';

type Props = {
  href: Href;
  label: string;
  variant?: Variant;
};

const variantClass: Record<Variant, string> = {
  primary: 'border-gray-950 bg-gray-950',
  secondary: 'border-gray-300 bg-white',
};

const textClass: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-gray-950',
};
