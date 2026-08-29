import type { PublicBanner } from '@/api/app-content';

export interface HomeBannerPagerProps {
  banners: PublicBanner[];
  frameWidth: number;
  frameHeight: number;
  selectedIndex: number;
  onSelectionChange: (index: number) => void;
  onInteractionStart?: () => void;
}
