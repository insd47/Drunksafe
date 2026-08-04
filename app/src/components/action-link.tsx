import { Link, useRouter, type Href } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { cn } from '@/lib/utils/cn';

export default function ActionLink({ href, label, variant = 'primary' }: Props) {
  const router = useRouter();
  const className = cn('h-11 items-center justify-center border px-4', variantClass[variant]);
  const textClassName = cn('text-sm font-semibold', textClass[variant]);

  if (process.env.EXPO_OS === 'web') {
    return (
      <Link href={href} asChild>
        <Pressable className={className}>
          <Text className={textClassName}>{label}</Text>
        </Pressable>
      </Link>
    );
  }

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className={className}
      onPress={() => router.push(href)}>
      <Text className={textClassName}>{label}</Text>
    </Pressable>
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
