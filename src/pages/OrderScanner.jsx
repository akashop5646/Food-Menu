import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Html5Qrcode } from 'html5-qrcode';

export default function OrderScanner() {
  const [qrInput, setQrInput] = useState('');
  const [parsedOrder, setParsedOrder] = useState(null);
  const [error, setError] = useState('');
  const [paymentType, setPaymentType] = useState('UPI'); // UPI, CASH, CARD
  const [paymentStatus, setPaymentStatus] = useState('PENDING'); // PAID, PENDING
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  const qrScannerRef = useRef(null);

  const startCamera = () => {
    setIsCameraOpen(true);
    setSuccessMsg('');
    setError('');
    
    // Slight delay to allow DOM to mount container div
    setTimeout(() => {
      const html5QrCode = new Html5Qrcode("qr-reader");
      qrScannerRef.current = html5QrCode;
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };
      
      html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          handleInputChange(decodedText);
          stopCamera();
        },
        (errorMessage) => {
          // ignore scanner loop feedback
        }
      ).catch(err => {
        console.error("Camera start error:", err);
        setError("Could not access camera. Ensure camera permissions are granted and you are using HTTPS/localhost.");
        setIsCameraOpen(false);
      });
    }, 150);
  };

  const stopCamera = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stop().then(() => {
        setIsCameraOpen(false);
        qrScannerRef.current = null;
      }).catch(err => {
        console.error("Camera stop error:", err);
        setIsCameraOpen(false);
      });
    } else {
      setIsCameraOpen(false);
    }
  };

  useEffect(() => {
    return () => {
      if (qrScannerRef.current) {
        qrScannerRef.current.stop().catch(console.error);
      }
    };
  }, []);

  // Handle parsing QR code payload
  const handleInputChange = (val) => {
    setQrInput(val);
    setError('');
    setSuccessMsg('');

    if (!val.trim()) {
      setParsedOrder(null);
      return;
    }

    try {
      // Clean up string in case of extra spaces or weird scanner formatting
      const cleanVal = val.trim();
      const parsed = JSON.parse(cleanVal);

      // Validation
      if (!parsed.table) {
        throw new Error('Missing "table" field.');
      }
      if (!parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
        throw new Error('Invalid or empty "items" array.');
      }
      if (parsed.total === undefined || parsed.total === null) {
        throw new Error('Missing "total" amount.');
      }

      setParsedOrder(parsed);
      setError('');
    } catch (err) {
      setParsedOrder(null);
      // Only show error if input is sufficiently long (to prevent flashing errors while typing)
      if (val.trim().length > 10) {
        setError('Invalid QR code format. Please scan a valid Aurum Table QR.');
      }
    }
  };

  // Submit verified order to backend
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!parsedOrder) return;

    setIsSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: parsedOrder.table,
          location: parsedOrder.location || null,
          items: parsedOrder.items,
          total: parsedOrder.total,
          paymentType: paymentStatus === 'PAID' ? 'NOW' : 'LATER', // Map NOW/LATER
          paymentStatus: paymentStatus,
          deviceId: parsedOrder.deviceId || null,
          customerIp: parsedOrder.customerIp || null,
          checkoutSessionId: parsedOrder.checkoutSessionId || null
        }),
        credentials: 'include'
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit order.');
      }

      setSuccessMsg(`Order for Table ${parsedOrder.table} verified and sent to Live KDS!`);
      // Reset states
      setQrInput('');
      setParsedOrder(null);
      setPaymentStatus('PENDING');
      setPaymentType('UPI');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setQrInput('');
    setParsedOrder(null);
    setPaymentStatus('PENDING');
    setPaymentType('UPI');
    setError('');
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-margin-mobile md:px-0 flex flex-col gap-6">
      <div className="bg-surface-container rounded-2xl border border-outline-variant/20 shadow-lg overflow-hidden">
        {/* Header */}
        <div className="p-6 md:p-8 border-b border-outline-variant/10">
          <h2 className="font-headline-md text-2xl text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">qr_code_scanner</span>
            Verify Customer Order
          </h2>
          <p className="font-body-md text-on-surface-variant mt-1">
            Scan the checkout QR code on the customer's device or paste the payload below to confirm order items and verify payments.
          </p>
        </div>

        <div className="p-6 md:p-8 flex flex-col gap-6">
          {successMsg && (
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-primary/10 text-primary px-4 py-4 rounded-xl border border-primary/20 text-sm font-medium flex items-center gap-3"
            >
              <span className="material-symbols-outlined text-xl">check_circle</span>
              <div>
                <strong className="block text-primary">Order Confirmed</strong>
                <span className="text-[12px] opacity-90">{successMsg}</span>
              </div>
            </motion.div>
          )}

          {error && (
            <div className="bg-error/10 text-error px-4 py-3 rounded-xl border border-error/20 text-sm font-medium">
              {error}
            </div>
          )}

          {!parsedOrder && (
            /* Camera Scanning Area */
            <div className="flex flex-col gap-4">
              {isCameraOpen ? (
                <div className="flex flex-col gap-4 items-center justify-center p-5 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl">
                  <div id="qr-reader" className="w-full max-w-sm overflow-hidden rounded-xl border-2 border-primary/30 bg-black shadow-inner"></div>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="bg-error/10 hover:bg-error/20 text-error border border-error/20 px-6 py-2.5 rounded-lg font-label-caps text-[11px] uppercase tracking-widest cursor-pointer transition-all flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[18px]">videocam_off</span>
                    Close Camera
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startCamera}
                  className="bg-primary text-on-primary px-6 py-4 rounded-xl font-label-caps text-[12px] uppercase tracking-widest gold-glow flex items-center justify-center gap-2 cursor-pointer transition-transform hover:scale-[1.02] active:scale-95"
                >
                  <span className="material-symbols-outlined">photo_camera</span>
                  Scan Order QR Code
                </button>
              )}
            </div>
          )}

          {/* Scanned Order Summary */}
          <AnimatePresence>
            {parsedOrder && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="border border-outline-variant/30 rounded-xl bg-surface-container-lowest overflow-hidden">
                  {/* Summary Slip */}
                  <div className="p-5 border-b border-outline-variant/20 bg-surface-container-low flex justify-between items-center">
                    <div>
                      <span className="font-label-caps text-[10px] text-primary uppercase tracking-widest block">Scanned Order</span>
                      <strong className="font-headline-sm text-lg text-on-surface">{parsedOrder.table}</strong>
                      {parsedOrder.location && (
                        <span className="text-xs text-on-surface-variant block mt-0.5 font-medium">{parsedOrder.location}</span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-widest block">Total Price</span>
                      <strong className="font-price-display text-lg text-primary">₹{Number(parsedOrder.total).toFixed(2)}</strong>
                    </div>
                  </div>

                  {/* Device & Network verification details */}
                  <div className="px-5 py-3 border-b border-outline-variant/15 bg-surface-container-lowest flex flex-col sm:flex-row justify-between text-xs text-on-surface-variant/70 gap-2 font-mono">
                    <div>
                      <span className="font-semibold text-primary font-sans">Customer IP:</span> {parsedOrder.customerIp || 'N/A'}
                    </div>
                    <div>
                      <span className="font-semibold text-primary font-sans">Device ID:</span> {parsedOrder.deviceId ? parsedOrder.deviceId.substring(0, 16) + '...' : 'N/A'}
                    </div>
                  </div>

                  <div className="p-5 flex flex-col gap-4">
                    {/* Items List */}
                    <div className="space-y-3">
                      <label className="block font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest">Ordered Items</label>
                      <div className="divide-y divide-outline-variant/10">
                        {parsedOrder.items.map((item, idx) => (
                          <div key={item.id || idx} className="py-2.5 flex justify-between items-center text-sm">
                            <span className="text-on-surface">
                              <span className="text-primary font-bold mr-1">{item.quantity}x</span> {item.name}
                            </span>
                            <span className="text-on-surface-variant font-medium">₹{(Number(item.price) * Number(item.quantity)).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <form onSubmit={handleSubmit} className="border-t border-outline-variant/10 pt-4 mt-2 flex flex-col gap-4">
                      <h4 className="font-label-caps text-[11px] text-on-surface-variant uppercase tracking-widest">Verification Details</h4>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Payment Type */}
                        <div>
                          <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Payment Method</label>
                          <select
                            value={paymentType}
                            onChange={(e) => setPaymentType(e.target.value)}
                            className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-3 py-2.5 focus:border-primary outline-none text-sm"
                          >
                            <option value="UPI">Google Pay / UPI</option>
                            <option value="CASH">Cash Payment</option>
                            <option value="CARD">Credit/Debit Card</option>
                          </select>
                        </div>

                        {/* Payment Status */}
                        <div>
                          <label className="block font-label-caps text-[11px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Payment Status</label>
                          <select
                            value={paymentStatus}
                            onChange={(e) => setPaymentStatus(e.target.value)}
                            className="w-full bg-surface-container-highest border border-outline-variant/50 text-on-surface rounded-lg px-3 py-2.5 focus:border-primary outline-none text-sm"
                          >
                            <option value="PENDING">Pending (Pay Later)</option>
                            <option value="PAID">Paid (Manually Verified)</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3 pt-3">
                        <button
                          type="button"
                          onClick={handleCancel}
                          className="flex-1 bg-surface-container-high border border-outline-variant/50 text-on-surface hover:text-error hover:border-error/50 py-3.5 rounded-xl font-label-caps text-[13px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px]">close</span>
                          Cancel / Reset
                        </button>
                        <button
                          type="submit"
                          disabled={isSubmitting}
                          className="flex-[2] bg-gold-metallic text-on-primary py-3.5 rounded-xl font-label-caps text-[13px] uppercase tracking-widest gold-glow flex items-center justify-center gap-2 cursor-pointer transition-transform active:scale-95 disabled:opacity-50"
                        >
                          {isSubmitting ? (
                            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                          ) : (
                            <span className="material-symbols-outlined text-[18px]">done_all</span>
                          )}
                          Confirm Order & Send to KDS
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
