import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

function formatMoney(value) {
  const amount = Number(value || 0);
  return `\u20B9${amount.toFixed(2)}`;
}

export default function ScanOrderPanel({
  codeInput,
  setCodeInput,
  parsedOrder,
  isVerifying,
  isSubmitting,
  onVerify,
  onCancel,
  onReview,
  paymentType,
  setPaymentType,
  paymentStatus,
  setPaymentStatus,
  focusTrigger
}) {
  const inputsRef = useRef([]);

  // Auto-focus first input on mount or when focusTrigger changes (e.g. on reset/cancel/verify)
  useEffect(() => {
    if (inputsRef.current[0] && !parsedOrder) {
      inputsRef.current[0].focus();
    }
  }, [focusTrigger, parsedOrder]);

  const handleInputChange = (e, idx) => {
    const val = e.target.value.replace(/[^0-9]/g, '');
    const newCode = codeInput.split('');
    newCode[idx] = val.slice(-1); // Keep only the last character entered

    // Fill gaps
    for (let i = 0; i < 4; i++) {
      if (!newCode[i]) newCode[i] = '';
    }
    const finalCode = newCode.join('');
    setCodeInput(finalCode);

    // Auto-focus next input
    if (val && idx < 3) {
      inputsRef.current[idx + 1]?.focus();
    }

    // Auto-verification guard: if code reaches 4 digits, trigger verification
    if (finalCode.length === 4 && !isVerifying) {
      onVerify(finalCode);
    }
  };

  const handleKeyDown = (e, idx) => {
    if (e.key === 'Backspace' && !codeInput[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '').slice(0, 4);
    setCodeInput(pasted);

    // Trigger verify if complete
    if (pasted.length === 4 && !isVerifying) {
      onVerify(pasted);
    } else {
      const nextIdx = Math.min(pasted.length, 3);
      inputsRef.current[nextIdx]?.focus();
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (codeInput.length === 4 && !isVerifying) {
      onVerify(codeInput);
    }
  };

  return (
    <>
      {!parsedOrder ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6">
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4 md:p-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div>
                <h3 className="font-headline-sm text-xl text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary">pin</span>
                  Enter Order Code
                </h3>
                <p className="text-sm text-on-surface-variant mt-2">
                  Ask the customer for their 4-digit order code and enter it below.
                </p>
              </div>

              <div className="flex flex-nowrap items-center justify-center gap-2 sm:gap-3 py-3">
                {[0, 1, 2, 3].map((idx) => (
                  <input
                    key={idx}
                    ref={(el) => (inputsRef.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={codeInput[idx] || ''}
                    onChange={(e) => handleInputChange(e, idx)}
                    onKeyDown={(e) => handleKeyDown(e, idx)}
                    onPaste={handlePaste}
                    className="w-full max-w-[56px] min-w-0 aspect-square text-center text-2xl sm:text-3xl font-bold font-mono bg-surface-container-highest border-2 border-outline-variant/50 rounded-xl text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition-all"
                  />
                ))}
              </div>

              <button
                type="submit"
                disabled={codeInput.length !== 4 || isVerifying}
                className="w-full h-12 py-0 bg-primary text-on-primary rounded-xl font-label-caps text-[12px] uppercase tracking-widest gold-glow flex items-center justify-center gap-2 cursor-pointer transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isVerifying ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                    Verifying...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined">verified</span>
                    Verify Code
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4 md:p-6 flex flex-col gap-4 justify-between">
            <div>
              <h3 className="font-headline-sm text-xl text-on-surface">Verification flow</h3>
              <p className="text-sm text-on-surface-variant mt-2">
                Enter the 4-digit code from the customer's device to pull up their order and confirm it.
              </p>
            </div>

            {/* Desktop step cards */}
            <div className="hidden md:grid md:grid-cols-1 gap-3">
              <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
                <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Step 1</div>
                <div className="text-sm text-on-surface mt-1">Ask the customer for their 4-digit order code.</div>
              </div>
              <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
                <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Step 2</div>
                <div className="text-sm text-on-surface mt-1">Verify items, payment method, and table details.</div>
              </div>
              <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high p-4">
                <div className="text-[10px] uppercase tracking-widest text-on-surface-variant">Step 3</div>
                <div className="text-sm text-on-surface mt-1">Confirm and send the order to Live KDS.</div>
              </div>
            </div>

            {/* Mobile stepper list */}
            <div className="flex md:hidden flex-col gap-4 border-l-2 border-outline-variant/30 pl-5 py-1 ml-2 text-left">
              <div className="relative">
                <div className="absolute -left-[28px] top-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-on-primary">1</div>
                <div className="text-[10px] font-label-caps text-on-surface-variant uppercase tracking-widest">Step 1</div>
                <div className="text-sm text-on-surface mt-0.5">Ask the customer for their 4-digit order code.</div>
              </div>
              <div className="relative">
                <div className="absolute -left-[28px] top-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-on-primary">2</div>
                <div className="text-[10px] font-label-caps text-on-surface-variant uppercase tracking-widest">Step 2</div>
                <div className="text-sm text-on-surface mt-0.5">Verify items, payment method, and table details.</div>
              </div>
              <div className="relative">
                <div className="absolute -left-[28px] top-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-on-primary">3</div>
                <div className="text-[10px] font-label-caps text-on-surface-variant uppercase tracking-widest">Step 3</div>
                <div className="text-sm text-on-surface mt-0.5">Confirm and send the order to Live KDS.</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border border-outline-variant/30 rounded-xl bg-surface-container-lowest overflow-hidden">
              <div className="p-5 border-b border-outline-variant/20 bg-surface-container-low flex flex-col gap-3">
                <div className="flex justify-between items-center gap-4">
                  <span className="font-label-caps text-[10px] text-primary uppercase tracking-widest">Verified Order</span>
                  <div className="text-right">
                    <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest block">Total Price</span>
                    <strong className="font-price-display text-lg text-primary">{formatMoney(parsedOrder.total)}</strong>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2.5">
                  <span className="material-symbols-outlined text-primary text-xl">table_restaurant</span>
                  <strong className="font-headline-sm text-lg text-primary">{parsedOrder.table}</strong>
                  {parsedOrder.location && (
                    <span className="text-xs text-on-surface-variant font-medium ml-auto">📍 {parsedOrder.location}</span>
                  )}
                </div>
              </div>

              <div className="px-5 py-3 border-b border-outline-variant/15 bg-surface-container-lowest flex flex-col sm:flex-row justify-between text-xs text-on-surface-variant/70 gap-2 font-mono">
                <div>
                  <span className="font-semibold text-primary font-sans text-xs">Order ID:</span>{' '}
                  <span className="text-primary font-bold text-sm tracking-wide">
                    {parsedOrder._id ? `#${parsedOrder._id.toString().substring(18)}` : 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="font-semibold text-primary font-sans">Customer IP:</span> {parsedOrder.customerIp || 'N/A'}
                </div>
                <div>
                  <span className="font-semibold text-primary font-sans">Device ID:</span> {parsedOrder.deviceId ? `${parsedOrder.deviceId.substring(0, 16)}...` : 'N/A'}
                </div>
              </div>

              <div className="p-5 flex flex-col gap-4">
                <div className="space-y-3">
                  <label className="block font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest">Ordered Items</label>
                  <div className="divide-y divide-outline-variant/10">
                    {parsedOrder.items.map((item, idx) => (
                      <div key={item.id || idx} className="py-2.5 flex justify-between items-center text-sm">
                        <span className="text-on-surface">
                          <span className="text-primary font-bold mr-1">{item.quantity}x</span> {item.name}
                        </span>
                        <span className="text-on-surface-variant font-medium">{formatMoney(Number(item.price) * Number(item.quantity))}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-outline-variant/10 pt-4 mt-2 flex flex-col gap-4">
                  <h4 className="font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest">Verification Details</h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Payment Method</label>
                      <select
                        value={paymentType}
                        onChange={(e) => setPaymentType(e.target.value)}
                        className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-3 py-2.5 focus:border-primary outline-none text-base md:text-sm"
                      >
                        <option value="ONLINE">Razorpay / Online</option>
                        <option value="CASH">Cash Payment</option>
                        <option value="CARD">Credit / Debit Card</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Payment Status</label>
                      <select
                        value={paymentStatus}
                        onChange={(e) => setPaymentStatus(e.target.value)}
                        className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-3 py-2.5 focus:border-primary outline-none text-base md:text-sm"
                      >
                        <option value="PENDING">Pending (Pay Later)</option>
                        <option value="PAID">Paid (Manually Verified)</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row gap-3 pt-4 pb-1 md:pb-0">
                    <button
                      type="button"
                      onClick={onCancel}
                      className="w-full md:flex-1 bg-surface-container-high/40 border border-outline-variant/30 text-on-surface-variant hover:text-error hover:border-error/50 h-12 py-0 rounded-xl font-label-caps text-[12px] md:text-[13px] uppercase tracking-wide md:tracking-widest transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                      Cancel / Reset
                    </button>
                    <button
                      type="button"
                      onClick={onReview}
                      disabled={isSubmitting}
                      className="w-full md:flex-[2] bg-gold-metallic text-on-primary-fixed h-12 py-0 rounded-xl font-label-caps text-[12px] md:text-[13px] uppercase tracking-wide md:tracking-widest gold-glow flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[18px]">visibility</span>
                      Review & Confirm Order
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </>
  );
}
