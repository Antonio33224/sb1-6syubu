import { Hero } from '@/components/home/Hero';
import { RankingsSection } from '@/components/home/RankingsSection';
import { LatestReviewsSection } from '@/components/home/LatestReviewsSection';
import { Newsletter } from '@/components/home/Newsletter';

export default function HomePage() {
  return (
    <>
      <Hero />
      <RankingsSection />
      <LatestReviewsSection />
      <Newsletter />
    </>
  );
}
