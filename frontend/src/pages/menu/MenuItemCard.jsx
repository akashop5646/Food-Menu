import React from 'react';
import MenuItemImage from './MenuItemImage';
import AvailabilityToggle from './AvailabilityToggle';

export default function MenuItemCard({
  item,
  isSelected,
  onSelectToggle,
  onToggleStatus,
  isStatusPending,
  isStatusDisabled,
  onEdit,
  onDuplicate,
  onDelete
}) {
  const categoriesList = item.categories || (item.category ? [item.category] : []);

  return (
    <div className={`bg-surface-container-low border border-outline-variant/20 rounded-xl p-4 flex flex-col gap-4 shadow-sm relative ${isSelected ? 'border-primary/45 bg-primary/[0.01]' : ''}`}>
      <div className="flex gap-4 items-start">
        {/* Selection Checkbox */}
        <label className="flex items-center justify-center cursor-pointer min-h-[36px] min-w-[36px] -mt-1 -ml-1 shrink-0">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onSelectToggle}
            className="w-4 h-4 rounded border-outline-variant/50 text-primary focus:ring-primary focus:ring-offset-0 focus:ring-1 outline-none bg-surface-container cursor-pointer"
            aria-label={`Select item ${item.name}`}
          />
        </label>

        {/* Image */}
        <MenuItemImage
          src={item.image}
          alt={item.name}
          className="w-16 h-16 rounded-lg border border-outline-variant/20 shrink-0"
        />

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-2">
            <h4 className="font-title-md text-on-surface text-base truncate pr-1">{item.name}</h4>
            <span className="font-price-display text-on-surface text-sm shrink-0">₹{item.price}</span>
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {categoriesList.map(cat => (
              <span
                key={cat}
                className="bg-surface-variant text-on-surface-variant px-2 py-0.5 rounded-full text-[10px] font-label-caps uppercase tracking-widest"
              >
                {cat}
              </span>
            ))}
          </div>
          {item.chefPick && (
            <div className="text-[9px] font-label-caps text-primary uppercase tracking-widest mt-1">
              Chef Pick
            </div>
          )}
        </div>
      </div>

      {/* Status and Action Buttons */}
      <div className="flex items-center justify-between border-t border-outline-variant/10 pt-3">
        {/* Availability Switch */}
        <AvailabilityToggle
          available={item.available}
          isPending={isStatusPending}
          disabled={isStatusDisabled}
          onClick={onToggleStatus}
          itemName={item.name}
        />

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onDuplicate}
            className="p-2 text-on-surface-variant hover:text-primary transition-colors bg-surface-container rounded-lg hover:bg-surface-bright flex items-center justify-center min-h-[36px] min-w-[36px]"
            title={`Duplicate ${item.name}`}
            aria-label={`Duplicate ${item.name}`}
          >
            <span className="material-symbols-outlined text-[18px]">content_copy</span>
          </button>
          <button
            onClick={onEdit}
            className="p-2 text-on-surface-variant hover:text-primary transition-colors bg-surface-container rounded-lg hover:bg-surface-bright flex items-center justify-center min-h-[36px] min-w-[36px]"
            title={`Edit ${item.name}`}
            aria-label={`Edit ${item.name}`}
          >
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>
          <button
            onClick={onDelete}
            className="p-2 text-on-surface-variant hover:text-error transition-colors bg-surface-container rounded-lg hover:bg-error/10 flex items-center justify-center min-h-[36px] min-w-[36px]"
            title={`Delete ${item.name}`}
            aria-label={`Delete ${item.name}`}
          >
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}
