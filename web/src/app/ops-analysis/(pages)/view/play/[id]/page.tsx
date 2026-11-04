'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import PlayStage from '../playStage';

const CarouselPlayPage = () => {
  const params = useParams<{ id: string }>();
  const carouselId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  if (!carouselId) {
    return null;
  }
  return <PlayStage carouselId={carouselId} />;
};

export default CarouselPlayPage;
