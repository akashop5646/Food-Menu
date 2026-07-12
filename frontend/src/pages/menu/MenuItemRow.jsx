import React from 'react';
import MenuItemImage from './MenuItemImage';
import AvailabilityToggle from './AvailabilityToggle';

export default function MenuItemRow({
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
    <tr className="border-b border-outline-variant/10 hover:bg-surface-container-highest/50 transition-colors">
      <td className="px-6 py-3">
        <label className="flex items-center justify-center cursor-pointer min-h-[40px] min-w-[40px]">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onSelectToggle}
            className="w-4 h-4 rounded border-outline-variant/50 text-primary focus:ring-primary focus:ring-offset-0 focus:ring-1 outline-none bg-surface-container cursor-pointer"
            aria-label={`Select item ${item.name}`}
          />
        </label>
      </td>
      <td className="px-6 py-3">
        <MenuItemImage
          src={item.image}
          alt={item.name}
          className="w-12 h-12 rounded border border-outline-variant/30"
        />
      </td>
      <td className="px-6 py-3">
        <div className="font-title-md text-on-surface text-sm sm:text-base">{item.name}</div>
        {item.chefPick && (
          <div className="text-[10px] font-label-caps text-primary uppercase tracking-widest mt-1">
            Chef Pick
          </div>
        )}
      </td>
      <td className="px-6 py-3">
        <div className="flex flex-wrap gap-1">
          {categoriesList.map(cat => (
            <span
              key={cat}
              className="bg-surface-variant text-on-surface-variant px-2 py-0.5 rounded-full text-[10px] font-label-caps uppercase tracking-widest"
            >
              {cat}
            </span>
          ))}
        </div>
      </td>
      <td className="px-6 py-3 font-price-display text-on-surface text-sm sm:text-base">
        ₹{item.price}
      </td>
      <td className="px-6 py-3">
        <AvailabilityToggle
          available={item.available}
          isPending={isStatusPending}
          disabled={isStatusDisabled}
          onClick={onToggleStatus}
          itemName={item.name}
        />
      </td>
      <td className="px-6 py-3 text-right space-x-2 shrink-0">
        <button
          onClick={onDuplicate}
          className="p-2 text-on-surface-variant hover:text-primary transition-colors bg-surface-container rounded hover:bg-surface-bright inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
          title={`Duplicate ${item.name}`}
          aria-label={`Duplicate ${item.name}`}
        >
          <span className="material-symbols-outlined text-[18px]">content_copy</span>
        </button>
        <button
          onClick={onEdit}
          className="p-2 text-on-surface-variant hover:text-primary transition-colors bg-surface-container rounded hover:bg-surface-bright inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
          title={`Edit ${item.name}`}
          aria-label={`Edit ${item.name}`}
        >
          <span className="material-symbols-outlined text-[18px]">edit</span>
        </button>
        <button
          onClick={onDelete}
          className="p-2 text-on-surface-variant hover:text-error transition-colors bg-surface-container rounded hover:bg-error/10 inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
          title={`Delete ${item.name}`}
          aria-label={`Delete ${item.name}`}
        >
          <span className="material-symbols-outlined text-[18px]">delete</span>
        </button>
      </td>
    </tr>
  );
}
