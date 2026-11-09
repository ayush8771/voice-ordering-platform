/**
 * English UI strings: the source dictionary and the fallback for every other
 * language. Keys are the type of every translation lookup, so a typo in a key
 * is a compile error.
 *
 * Only frontend-owned text lives here. Menu items, categories, outlet names,
 * server error messages and order data are displayed exactly as received.
 *
 * Placeholders are `{name}`. Plural pairs end in `.one` / `.other`.
 */
export const en = {
  // --- Language picker ------------------------------------------------------
  'lang.label': 'Language',

  // --- Shared ----------------------------------------------------------------
  'common.retry': 'Retry',
  'common.total': 'Total',
  'common.comingSoon': 'Coming soon',
  'common.qr': 'QR',
  'common.kiosk': 'Kiosk',

  // --- Connection status -----------------------------------------------------
  'conn.heading': 'Backend connection',
  'conn.checking': 'Checking the connection to the API…',
  'conn.error': 'Not connected: {message} Start the backend and reload.',
  'conn.apiStatus': 'API status',
  'conn.connected': 'Connected — {status} ({version})',
  'conn.mongodb': 'MongoDB',

  // --- Customer shell --------------------------------------------------------
  'shell.whichOutlet': 'Which outlet?',
  'shell.noOutlet':
    'This link does not name an outlet, so no menu can be loaded. Scan the QR code on your table, or ask at the counter.',
  'shell.devNote': 'Developer note: open {qr} (or {kiosk}) against a seeded backend.',

  // --- Session and startup ---------------------------------------------------
  'session.endedTitle': 'Session ended',
  'session.endedBody':
    'This ordering session has expired, so the draft is gone. Start again, or order at the counter.',
  'session.startNew': 'Start a new order',
  'startup.title': 'Ordering',
  'startup.loading': 'Loading the menu…',
  'startup.failed':
    'We could not load the menu: {reason} The menu is not empty — please retry or order at the counter.',
  'startup.connectionProblem': 'connection problem.',

  // --- Ordering screen -------------------------------------------------------
  'order.kioskSubtitle': 'Kiosk ordering',
  'order.qrSubtitle': 'Ordering on your phone',
  'menu.heading': 'Menu',
  'menu.empty': 'This outlet has published no items yet. Please ask at the counter.',
  'search.label': 'Search dishes',
  'search.placeholder': 'e.g. dosa',
  'search.clear': 'Clear',
  'categories.label': 'Menu categories',
  'categories.all': 'All',
  'results.search.one': '{count} dish matches “{query}”.',
  'results.search.other': '{count} dishes match “{query}”.',
  'results.searchIn.one': '{count} dish matches “{query}” in {category}.',
  'results.searchIn.other': '{count} dishes match “{query}” in {category}.',
  'results.showing.one': 'Showing {category}: {count} dish.',
  'results.showing.other': 'Showing {category}: {count} dishes.',
  'empty.search': 'No dishes match “{query}”.',
  'empty.searchIn': 'No dishes match “{query}” in {category}.',
  'empty.category': 'No dishes in this category.',
  'empty.hint': 'Check the spelling, try a shorter word, or browse all categories.',
  'empty.clearSearch': 'Clear search',
  'empty.showAll': 'Show all categories',

  // --- Menu item -------------------------------------------------------------
  'item.available': 'Available',
  'item.soldOut': 'Sold out',
  'item.addOns': 'Add-ons',
  'item.addOnsHint': '(optional, choose any)',
  'item.noExtraCharge': 'No extra charge',
  'item.add': 'Add {name}',
  'item.addWith.one': 'Add {name} with {count} add-on',
  'item.addWith.other': 'Add {name} with {count} add-ons',
  'item.soldOutButton': 'Sold out — cannot be added',
  'option.generic': 'Add-on',

  // --- Cart ------------------------------------------------------------------
  'cart.heading': 'Your order',
  'cart.empty': 'Nothing added yet. Browse the menu, or ask for something above.',
  'cart.notOrderable': 'Not orderable: {reasons} It is not included in your total.',
  'cart.fewer': 'Fewer {name}',
  'cart.more': 'More {name}',
  'cart.quantityOf': 'Quantity of {name}',
  'cart.remove': 'Remove',
  'cart.removeItem': 'Remove {name}',
  'cart.review': 'Review and confirm',
  'cart.clear': 'Clear order',
  'cart.view.one': 'View your order ({count} item)',
  'cart.view.other': 'View your order ({count} items)',
  'blocked.empty': 'Add something to your order first.',
  'blocked.unavailable':
    'Remove or replace the unavailable items below before you continue.',
  'issue.itemUnavailable': 'Sold out right now.',
  'issue.itemNotOnMenu': 'No longer on the menu.',
  'issue.optionUnavailable': 'That customisation is unavailable right now.',
  'issue.optionNotOnItem': 'That customisation is no longer offered for this item.',
  'issue.notPriceable': 'This item cannot be priced right now.',

  // --- Typed assistant (QR) --------------------------------------------------
  'assistant.heading': 'Ask for something',
  'assistant.unavailable':
    'The assistant is unavailable right now. Please use the menu below — your order is unaffected.',
  'assistant.typeLabel': 'Type what you would like',
  'assistant.send': 'Send',
  'assistant.noVoice':
    'Voice input is not available in this build. Typing and the menu work the same way.',

  // --- Voice kiosk -----------------------------------------------------------
  'voice.heading': 'Voice and typed ordering',
  'voice.ready.title': 'Ready to listen',
  'voice.ready.detail': 'Tap the microphone and say what you would like.',
  'voice.listening.title': 'Listening…',
  'voice.listening.detail': 'Speak now. Tap again when you have finished.',
  'voice.processing.title': 'Working on it…',
  'voice.processing.detail': 'Updating your draft order.',
  'voice.responding.title': 'Responding',
  'voice.responding.detail': 'Here is what the assistant said.',
  'voice.error.title': 'Voice did not work',
  'voice.error.detail': 'Nothing was added. Try again, type below, or use the menu.',
  'voice.assistantDown.title': 'Assistant unavailable',
  'voice.assistantDown.detail':
    'The assistant cannot help right now. Order with the menu below — it works the same way.',
  'voice.notConnected.title': 'Voice ordering is not available yet',
  'voice.notConnected.detail':
    'Voice will be switched on once the speech service is connected. You can type a request, or order with the menu below.',
  'voice.mic.stop': 'Stop listening',
  'voice.mic.start': 'Start voice ordering',
  'voice.mic.unavailable': 'Voice ordering unavailable',
  'voice.cancel': 'Cancel',
  'voice.dismiss': 'Dismiss',
  'voice.assistantPrefix': 'Assistant:',
  'voice.typeLabel': 'Or type what you would like',
  'voice.note': 'Nothing is ordered until you review and confirm it on screen.',

  // --- Review ----------------------------------------------------------------
  'review.title': 'Review your order',
  'review.hint': 'Check your items and total. You choose how to pay on the next step.',
  'review.continue': 'Continue to payment',
  'review.backToMenu': 'Back to the menu',

  // --- Checkout progress -----------------------------------------------------
  'checkout.progress': 'Checkout progress',
  'checkout.review': 'Review',
  'checkout.payment': 'Payment',
  'checkout.confirmed': 'Confirmed',
  'checkout.done': '(done)',

  // --- Payment step ----------------------------------------------------------
  'pay.title': 'Payment',
  'pay.summary': 'Order summary',
  'pay.items.one': '{count} item',
  'pay.items.other': '{count} items',
  'pay.payable': 'Total payable',
  'pay.question': 'How would you like to pay?',
  'pay.onlineUnavailableTag': 'Online payment unavailable',
  'pay.payingUpi': 'Paying by UPI',
  'pay.payingCash': 'Paying cash on pickup',
  'pay.noticeStrong': 'Confirming places your order. It does not take a payment.',
  'pay.noticeRest':
    'The outlet confirms your payment separately, and this screen shows it once they do.',
  'pay.confirm': 'Confirm order · {total}',
  'pay.backToReview': 'Back to review',
  'pay.chooseHint': 'Choose a payment method to continue.',
  'pay.retryUnknown':
    'We could not tell whether your order was created. Press Confirm order again — a retry cannot create a second order. Your payment choice is kept so the retry matches.',
  'pay.qrAria':
    'UPI QR code area. No QR code is shown because online UPI payment is not connected.',
  'pay.qrLabel': 'UPI QR code',
  'pay.qrNote': 'Not available yet',
  'pay.cardLabel': 'Payment',
  'pay.method': 'Method',
  'pay.paid': 'Paid',
  'pay.amountToPay': 'Amount to pay',
  'pay.cashHint':
    'Show token {token} at the counter and pay in cash. Staff will mark your order as paid.',

  // --- Payment methods -------------------------------------------------------
  'method.upiQr.title': 'UPI',
  'method.upiQr.short': 'UPI',
  'method.upiQr.summaryOnline': 'Pay with any UPI app.',
  'method.upiQr.summary':
    'Online UPI is not connected yet. Staff confirm your payment at the counter.',
  'method.upiQr.step1': 'Confirm your order to get a pickup token.',
  'method.upiQr.step2': 'Go to the counter with your token to pay.',
  'method.upiQr.step3': 'Staff confirm your payment. This screen updates once they do.',
  'method.cashAtCounter.title': 'Cash on pickup',
  'method.cashAtCounter.short': 'Cash on pickup',
  'method.cashAtCounter.summary':
    'Pay in cash at the counter when you collect your order.',
  'method.cashAtCounter.step1': 'Confirm your order to get a pickup token.',
  'method.cashAtCounter.step2':
    'Pay in cash at the counter when you collect your order.',
  'method.cashAtCounter.step3':
    'Staff record your payment. This screen updates once they do.',

  // --- Payment states --------------------------------------------------------
  'payview.notSelected.title': 'Choose how to pay',
  'payview.notSelected.body':
    'Pick UPI or cash on pickup to continue. Nothing is charged on this screen.',
  'payview.awaitingUpi.title': 'Payment pending',
  'payview.awaitingUpi.body':
    'Your order is confirmed, but your payment is not yet. Online UPI is not connected, so nothing has been charged. Pay at the counter with your token; staff will confirm it.',
  'payview.dueAtCounter.title': 'Pay at the counter',
  'payview.dueAtCounter.body':
    'Your order is confirmed, but your payment is not yet. Pay in cash at the counter when you collect your order.',
  'payview.pending.title': 'Payment pending',
  'payview.pending.body':
    'Your order is confirmed, but your payment is not yet. Staff will confirm it at the counter.',
  'payview.successful.title': 'Payment confirmed',
  'payview.successful.body': 'The outlet has confirmed your payment.',
  'payview.failed.title': 'Payment failed',
  'payview.failed.body':
    'No payment was recorded for this order. Please pay at the counter or ask staff for help.',
  'payview.refunded.title': 'Payment refunded',
  'payview.refunded.body':
    'The outlet has recorded a refund for this order. Ask at the counter if you have questions.',
  'payview.orderCancelled.title': 'Order cancelled',
  'payview.orderCancelled.body':
    'This order was cancelled. Please ask at the counter about any payment you made.',
  'payview.unknown.title': 'Payment status unknown',
  'payview.unknown.body':
    'We could not read your payment status. Please ask at the counter.',
  'payview.providerUnavailable.title': 'Online UPI payment unavailable',
  'payview.providerUnavailable.body':
    'Online UPI is not connected yet, so no QR code, UPI ID or payment link is shown here. You can still order and pay at the counter.',
  'payview.verifying.title': 'Checking your payment',
  'payview.verifying.body':
    'We are waiting for the payment provider to confirm your payment.',
  'payview.paymentCancelled.title': 'Payment cancelled',
  'payview.paymentCancelled.body':
    'The payment was cancelled before it completed. Your order is still confirmed — pay at the counter.',

  // --- Tracking --------------------------------------------------------------
  'tracking.title': 'Order confirmed',
  'tracking.token': 'Pickup token',
  'tracking.orderConfirmed': 'Order confirmed',
  'tracking.kitchen': 'Kitchen: {status}',
  'tracking.lastUpdated': 'Last updated {time}',
  'tracking.noLive':
    'Live status updates are not available for this order on this screen, so the statuses above will not change here. Please watch for token {token} at the counter.',
  'tracking.refresh': 'Refresh status',
  'tracking.another': 'Start another order',

  // --- Customer order and payment status wording -----------------------------
  'orderStatus.accepted': 'Order received',
  'orderStatus.preparing': 'Being prepared',
  'orderStatus.ready': 'Ready for pickup',
  'orderStatus.collected': 'Collected',
  'orderStatus.cancelled': 'Cancelled',
  'orderStatus.unknown': 'Status updating - please check at the counter',
  'paymentStatus.pending': 'Awaiting payment confirmation',
  'paymentStatus.dueAtCounter': 'Pay at the counter',
  'paymentStatus.verified': 'Payment confirmed',
  'paymentStatus.failed': 'Payment failed - please ask at the counter',
  'paymentStatus.refunded': 'Refunded',
  'paymentStatus.unknown': 'Payment status unknown - please ask at the counter',

  // --- Frontend-owned errors -------------------------------------------------
  'error.generic': 'Something went wrong. Please try again or ask at the counter.',
  'error.network': 'Could not reach the server.',
  'error.unexpected': 'The server returned an unexpected response.',
  'error.draftChanged':
    'Your order changed while you were editing. Please check it below.',
  'error.cartConflict':
    'That change could not be made. Please check your order and try again.',
  'error.reviewBeforePay': 'Please review your order again before choosing how to pay.',
  'error.reviewBeforeConfirm': 'Please review your order again before confirming.',
  'error.sameMethod':
    'Your last attempt may already have reached the outlet, so please retry with the same payment choice.',
  'error.staleQuote':
    'Your order was not placed: prices or availability changed. Please check the updated order and confirm again.',
  'error.menuChanged':
    'Your order was not placed because something on the menu changed. Please check your order.',
  'error.noLiveStatus':
    'Live status is not available for this order on this screen. Please watch for your token at the counter.',

  // --- Merchant dashboard ----------------------------------------------------
  'm.brand': 'Voice Ordering',
  'm.outlet': 'Outlet:',
  'm.notSelected': 'not selected',
  'm.navLabel': 'Merchant',
  'm.nav.overview': 'Dashboard',
  'm.nav.orders': 'Orders',
  'm.nav.menu': 'Menu',
  'm.title.overview': "Today's overview",
  'm.title.orders': 'Orders',
  'm.title.menu': 'Menu management',
  'm.staff': 'Staff member',
  'm.signInUnavailable': 'Sign-in not available yet',
  'm.source.label': 'Data source',
  'm.source.demo': 'Sample data',
  'm.source.live': 'Live data',
  'm.demoBannerStrong': 'Sample data.',
  'm.demoBannerRest':
    "These orders are demo fixtures, not your outlet's live orders. Live order data needs the merchant API and staff sign-in, which are not built yet.",
  'm.status.accepted': 'Pending',
  'm.status.preparing': 'Preparing',
  'm.status.ready': 'Ready',
  'm.status.collected': 'Completed',
  'm.status.cancelled': 'Cancelled',
  'm.pay.pending': 'Awaiting UPI',
  'm.pay.dueAtCounter': 'Due at counter',
  'm.pay.verified': 'Paid',
  'm.pay.failed': 'Failed',
  'm.pay.refunded': 'Refunded',
  'm.method.upiQr': 'UPI QR',
  'm.method.cashAtCounter': 'Cash',
  'm.summary.label': 'Today at a glance',
  'm.summary.total': "Today's orders",
  'm.summary.inProgress': 'In progress',
  'm.summary.inProgressHint': 'Pending, preparing or ready',
  'm.summary.completed': 'Completed',
  'm.summary.revenue': "Today's revenue",
  'm.summary.revenueHint': 'Excludes cancelled orders',
  'm.recent.heading': 'Recent orders',
  'm.recent.viewAll': 'View all orders',
  'm.recent.emptyTitle': 'No orders yet today',
  'm.recent.emptyBody': 'New orders will appear here.',
  'm.items.one': '{count} item',
  'm.items.other': '{count} items',
  'm.statusChart': 'Order status',
  'm.filters.label': 'Filter by order status',
  'm.filters.all': 'All',
  'm.orders.note':
    'Status changes (start preparing, mark ready, collected) and payment confirmation need the merchant API and staff sign-in, so they are not available here yet.',
  'm.orders.emptyAll': 'No orders yet',
  'm.orders.emptyFiltered': 'No {status} orders',
  'm.orders.showAll': 'Show all orders',
  'm.orders.emptyAllBody': 'New orders will appear here.',
  'm.orders.tryAnother': 'Try another status.',
  'm.orders.token': 'Token #{token}',
  'm.orders.addOns.one': '(+{count} add-on)',
  'm.orders.addOns.other': '(+{count} add-ons)',
  'm.orders.order': 'Order',
  'm.orders.payment': 'Payment ({method})',
  'm.orders.updateStatus': 'Update status',
  'm.live.loadingTitle': 'Loading dashboard data…',
  'm.live.loadingBody': 'Checking the backend.',
  'm.live.backendDownTitle': 'Backend connection unavailable',
  'm.live.backendDownBody':
    'The dashboard could not reach the server. Check that the backend is running.',
  'm.live.unavailableTitle': 'Dashboard data unavailable',
  'm.live.unavailableBody':
    'The backend is reachable, but it has no merchant order API yet, and staff sign-in is not decided. Live orders will appear here once both exist.',
  'm.live.showSample': 'Show sample data',
  'm.menu.note':
    'Live public menu, read-only. Editing needs a merchant menu API, which does not exist yet — nothing here is saved.',
  'm.menu.addItem': '+ Add item',
  'm.menu.noOutletTitle': 'No outlet selected',
  'm.menu.noOutletBody': 'Open this page with an outlet, for example {example}.',
  'm.menu.loading': 'Loading menu…',
  'm.menu.unavailable': 'Menu unavailable',
  'm.menu.unreachable': 'The server could not be reached.',
  'm.menu.emptyTitle': 'No menu items',
  'm.menu.emptyBody': 'This outlet has not published any items yet.',
  'm.menu.count.one': '({count} item)',
  'm.menu.count.other': '({count} items)',
  'm.menu.addOns': 'Add-ons:',
  'm.menu.edit': 'Edit',
  'm.menu.markSoldOut': 'Mark sold out',
  'm.menu.markAvailable': 'Mark available',

  // --- Kitchen display -------------------------------------------------------
  'k.title': 'Kitchen',
  'k.outlet': 'Outlet:',
  'k.notSelected': 'not selected',
  'k.countsLabel': 'Orders by status',
  'k.demoTag': 'DEMO DATA',
  'k.source.label': 'Data source',
  'k.source.demo': 'Demo data',
  'k.source.live': 'Live data',
  'k.refresh': 'Refresh',
  'k.bannerStrong': 'Demo data.',
  'k.bannerRest':
    "These tickets are sample fixtures, not this outlet's live orders. A live kitchen feed needs the kitchen API and staff sign-in, which are not built yet.",
  'k.noOutletTitle': 'Which outlet?',
  'k.noOutletBody':
    'This link does not name an outlet, so no orders can be shown. Open {example}.',
  'k.loadingTitle': 'Loading kitchen orders…',
  'k.loadingBody': 'Checking the backend.',
  'k.backendDownTitle': 'Backend unavailable',
  'k.backendDownBody':
    'The kitchen display could not reach the server (checked at {time}). This does not mean there are no orders — check that the backend is running.',
  'k.showDemo': 'Show demo data',
  'k.liveUnavailableTitle': 'Live kitchen data unavailable',
  'k.liveUnavailableBody':
    'The backend is reachable, but it has no kitchen order feed yet, and staff sign-in is not decided. Live tickets will appear here once both exist.',
  'k.lastRefreshed': 'Last refreshed {time}',
  'k.lastChecked': 'Last checked {time}',
  'k.hidden.one': '{count} collected or cancelled order is not shown',
  'k.hidden.other': '{count} collected or cancelled orders are not shown',
  'k.statusChangesSoon':
    'Status changes are coming soon: they need the kitchen API and staff sign-in.',
  'k.emptyTitle': 'No orders in the kitchen',
  'k.emptyBody': 'New orders for this outlet will appear here.',
  'k.emptyHidden': 'Collected and cancelled orders are not shown.',
  'k.col.new.title': 'New',
  'k.col.new.description': 'Accepted, waiting to start',
  'k.col.new.action': 'Start preparing',
  'k.col.new.empty': 'No new orders waiting.',
  'k.col.preparing.title': 'Preparing',
  'k.col.preparing.description': 'Being cooked now',
  'k.col.preparing.action': 'Mark ready',
  'k.col.preparing.empty': 'Nothing is being prepared.',
  'k.col.ready.title': 'Ready',
  'k.col.ready.description': 'Waiting for pickup',
  'k.col.ready.action': 'Mark collected',
  'k.col.ready.empty': 'No orders waiting for pickup.',
  'k.status.accepted': 'New',
  'k.status.preparing': 'Preparing',
  'k.status.ready': 'Ready',
  'k.status.collected': 'Collected',
  'k.status.cancelled': 'Cancelled',
  'k.ticket.token': 'Token',
  'k.ticket.order': 'Order {orderId} · {channel}',
  'k.ticket.received': 'Received {time}',
  'k.ticket.ariaAgo': 'Token {token}, {status}, received {elapsed} ago',
  'k.ticket.ariaNow': 'Token {token}, {status}, received just now',
  'k.ticket.payment': 'Payment: {status}',
  'k.ticket.actionTitle': 'Coming soon: needs the kitchen API and staff sign-in',
  'k.age.watch': 'Long wait',
  'k.age.late': 'Very long wait',
  'k.addOns.one': '+{count} add-on',
  'k.addOns.other': '+{count} add-ons',
  'k.elapsed.now': 'Just now',
  'k.elapsed.minutes': '{minutes} min',
  'k.elapsed.hours': '{hours} h {minutes} min',
} as const;

export type MessageKey = keyof typeof en;
