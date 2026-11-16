import Image from 'next/image';

export function BrandMark() {
  return <Image className="brand-mark" src="/icon.png" alt="" width={36} height={36} loading="eager" unoptimized />;
}
