import React, { useState, useEffect, useRef } from 'react';

export default function MenuItemImage({ src, alt, className = "" }) {
  const [isLoading, setIsLoading] = useState(Boolean(src));
  const [hasError, setHasError] = useState(false);
  const imageRef = useRef(null);

  // Reset image state whenever src changes
  useEffect(() => {
    setIsLoading(Boolean(src));
    setHasError(false);
  }, [src]);

  // Check for cached images after mount and whenever src changes
  useEffect(() => {
    const image = imageRef.current;
    if (!image || !src) return;

    if (image.complete) {
      if (image.naturalWidth > 0) {
        setIsLoading(false);
        setHasError(false);
      } else {
        setIsLoading(false);
        setHasError(true);
      }
    }
  }, [src]);

  const showPlaceholder = hasError || !src;

  return (
    <div className={`relative overflow-hidden bg-surface-variant flex items-center justify-center shrink-0 ${className}`}>
      {/* Display the skeleton as an absolute overlay only while isLoading is true */}
      {isLoading && !showPlaceholder && (
        <div className="absolute inset-0 z-10 animate-pulse bg-surface-container-highest" />
      )}
      
      {/* Keep the img element mounted while loading */}
      {!showPlaceholder ? (
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          loading="lazy"
          className={`w-full h-full object-cover transition-opacity duration-300 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
          onLoad={() => {
            setIsLoading(false);
            setHasError(false);
          }}
          onError={() => {
            setIsLoading(false);
            setHasError(true);
          }}
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full text-on-surface-variant opacity-50">
          <span className="material-symbols-outlined text-[20px]">restaurant</span>
        </div>
      )}
    </div>
  );
}
