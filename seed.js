// seed.js — DashCal seed data module
import { showStatus } from './statusbar.js';
import {
  normalizeHex, normalizeStoredItemColour, cloneItem,
  DEFAULT_COLOURS, SEED_INSTALLED_KEY, SEED_START_KEY,
  toISODate, clamp, formatFriendlyDate
} from './db.js';

function seedInstalledKey(calId) {
  const id = calId ?? 0;
  return `${SEED_INSTALLED_KEY}-cal-${id}`;
}
function seedStartKey(calId) {
  const id = calId ?? 0;
  return `${SEED_START_KEY}-cal-${id}`;
}

function isSeedInstalled(activeCalendarId) {
  return localStorage.getItem(seedInstalledKey(activeCalendarId)) === '1';
}

function installSeedData(startDateISO, ctx) {
  const { activeCalendarId, workingWeek, db, usingSqlRuntime, runSql, persistDb } = ctx;
  if (isSeedInstalled(activeCalendarId)) return;

  const visibleDates = [];
  const totalVisibleDays = 4 * workingWeek.length;
  const cursor = new Date(`${startDateISO}T00:00:00`);
  const maxScan = 365;
  let scanned = 0;

  while (visibleDates.length < totalVisibleDays && scanned < maxScan) {
    const dow = cursor.getDay();
    if (workingWeek.includes(dow)) visibleDates.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
    scanned++;
  }

  const seedTemplates = [
    { vd: 0,  time: '', title: 'Register business name and domain', notes: 'Decided on Pawfect & Co. as the brand name. Domain available and secured. Need to sort socials next — Instagram and TikTok are the priority channels for this kind of product.', colour: '#6178A0', size: 90 },
    { vd: 0,  time: '', title: 'Draft brand guidelines', notes: 'Colour palette, typography and tone of voice. Warm, playful but not childish. The products are for dogs but the buyers are adults who take their pets seriously.', colour: '#EAC96A', size: 75 },
    { vd: 1,  time: '', title: 'Source personalised collar supplier', notes: 'Shortlisted three UK based suppliers. Lead times vary between 5 and 12 days. Need to order samples before committing. Minimum order quantities are manageable for launch.', colour: '#81BB95', size: 90 },
    { vd: 1,  time: '', title: 'Build product photography kit list', notes: '', colour: '#EAC96A', size: 35 },
    { vd: 2,  time: '', title: 'Set up Shopify store', notes: 'Theme selected and installed. Navigation structure agreed. Product pages, about page and FAQ still to populate. Payment gateway connected and test transaction confirmed.', colour: '#6178A0', size: 90 },
    { vd: 3,  time: '', title: 'Order product samples', notes: 'Three collar styles and two bandana designs ordered from shortlisted suppliers. Estimated arrival 7 working days. Will photograph on arrival for first content batch.', colour: '#81BB95', size: 35 },
    { vd: 3,  time: '', title: 'Write brand story for about page', notes: '', colour: '#EAC96A', size: 35 },
    { vd: 4,  time: '10:00', title: 'Kick off call with product designer', notes: 'Walked through the personalisation options we want to offer at launch. Agreed on name embroidery for collars and bandanas, and a custom portrait print as a premium product. Mockups to follow by end of week.', colour: '#81BB95', size: 90 },
    { vd: 5,  time: '08:30', title: 'Morning social media check', notes: 'Reviewed overnight engagement across Instagram and TikTok. Two posts performing above average. Replied to all comments and DMs before starting the main day.', colour: '#E08C46', size: 75 },
    { vd: 5,  time: '', title: 'Produce marketing calendar', notes: 'Mapped out the first 8 weeks of content and promotional activity. Launch week, first review push, first sale event and a seasonal hook all plotted. Will feed into the content schedule from next week.', colour: '#E08C46', size: 90 },
    { vd: 5,  time: '13:00', title: 'Lunch call with mentor', notes: 'Monthly catch up. Talked through the launch plan and got some useful pushback on the pricing strategy. Suggested testing a bundle offer early rather than waiting for month two.', colour: '#AA9B87', size: 90 },
    { vd: 5,  time: '15:30', title: 'Draft launch email copy', notes: 'First pass at the friends and family launch email. Kept it personal and direct. Asked for shares rather than sales. Will review tomorrow with fresh eyes before scheduling.', colour: '#6178A0', size: 75 },
    { vd: 5,  time: '17:00', title: 'Update task list and plan tomorrow', notes: '', colour: '#EAC96A', size: 35 },
    { vd: 6,  time: '', title: 'Competitor research', notes: 'Reviewed top 10 Etsy sellers in the personalised dog product space. Price points, photography style, review volume and shipping promises all noted. Gap identified in the premium personalised portrait space.', colour: '#6178A0', size: 75 },
    { vd: 7,  time: '', title: 'Set up Etsy shop', notes: 'Shop opened, policies written, shipping profiles set. First three listings drafted but not published — waiting on final product photos before going live.', colour: '#6FB7C3', size: 90 },
    { vd: 7,  time: '', title: 'Write product descriptions — collars', notes: '', colour: '#EAC96A', size: 35 },
    { vd: 8,  time: '09:00', title: 'Product photography — collars and bandanas', notes: 'Shot all three collar styles and both bandana designs on a neutral backdrop. Also got some lifestyle shots using a neighbour\'s golden retriever — absolute professional, barely moved. Really happy with the results.', colour: '#EAC96A', size: 95 },
    { vd: 9,  time: '', title: 'Edit product photography', notes: 'Culled and edited the full shoot. 34 finals selected across product and lifestyle. Exported in Shopify and Etsy recommended dimensions. Hero images selected for each listing.', colour: '#EAC96A', size: 75 },
    { vd: 9,  time: '', title: 'Write product descriptions — bandanas', notes: '', colour: '#EAC96A', size: 35 },
    { vd: 10, time: '', title: 'Set up Amazon Seller account', notes: 'Account created but approval still pending for the personalised products category. This might take a few days. Will focus on Shopify and Etsy at launch and add Amazon once approved.', colour: '#6FB7C3', size: 75 },
    { vd: 11, time: '14:00', title: 'Finance setup — accounting software', notes: 'Xero connected to Shopify and business bank account. Chart of accounts configured for product, shipping, marketing and platform fees. First month projections entered as a baseline.', colour: '#AA9B87', size: 90 },
    { vd: 11, time: '', title: 'Pricing review', notes: 'Finalised pricing across all products. Collars £24-£32 depending on personalisation. Bandanas £14. Portrait prints £45. Margins healthy at Shopify direct, tighter on Etsy once fees accounted for. Amazon will need a price uplift.', colour: '#AA9B87', size: 75 },
    { vd: 12, time: '10:00', title: 'First content shoot — lifestyle video', notes: 'Shot a short form video series in the park with two dogs. Collar and bandana worn throughout. Got some genuinely great candid moments. Will cut into three short clips for Instagram and TikTok.', colour: '#EAC96A', size: 95 },
    { vd: 13, time: '', title: 'Edit and schedule launch content', notes: 'Cut the park footage into three clips. Added captions and brand overlays. Scheduled across Instagram and TikTok for the two weeks leading up to launch. Teaser post goes out tomorrow.', colour: '#E08C46', size: 90 },
    { vd: 14, time: '', title: 'Publish Shopify listings', notes: 'All product pages live. SEO titles and meta descriptions written. Photography uploaded. Personalisation options configured as product variants. Test order placed and fulfilled correctly.', colour: '#6FB7C3', size: 90 },
    { vd: 14, time: '', title: 'Publish Etsy listings', notes: '', colour: '#6FB7C3', size: 35 },
    { vd: 15, time: '09:30', title: 'Launch email — friends and family', notes: 'Sent a personal launch announcement to 60 contacts. Soft ask for shares rather than sales. Three orders came in within the hour which was a brilliant start and great for early Etsy algorithm signals.', colour: '#E08C46', size: 90 },
    { vd: 15, time: '', title: 'Set up abandoned cart email sequence', notes: '', colour: '#6FB7C3', size: 35 },
    { vd: 16, time: '', title: 'Craft fair — local dog show', notes: 'Full day at the Riverside Dog Show. Took a table with the full product range. Sold 14 items, collected 40 email addresses and got some brilliant real world feedback. The portrait prints got the most attention by far.', colour: '#A47F9B', size: 110 },
    { vd: 17, time: '', title: 'Post craft fair follow up', notes: 'Emailed everyone who signed up at the show. 6 orders placed within 24 hours. Added a note to each order thanking them for coming to the show. Small touch but worth doing at this stage.', colour: '#E08C46', size: 75 },
    { vd: 17, time: '', title: 'Restock order — collars', notes: 'Collar stock lower than expected after the show. Placed a restock order with supplier two who had the better lead time. Should arrive before the weekend rush.', colour: '#81BB95', size: 35 },
    { vd: 18, time: '11:00', title: 'First week sales review', notes: 'Week one total: 31 orders across Shopify and Etsy. Revenue £680. Etsy outperforming Shopify at this stage which is expected — the organic traffic there is much stronger early on. Amazon still pending approval.', colour: '#AA9B87', size: 90 },
    { vd: 19, time: '', title: 'Write first blog post', notes: 'How to choose the right collar size for your dog. Informational, useful, naturally introduces the product range without being a sales piece. Submitted to Shopify blog. Will share across socials once live.', colour: '#EAC96A', size: 75 },
    { vd: 20, time: '', title: 'Personal — rest day', notes: '', colour: '#A47F9B', size: 35 },
    { vd: 21, time: '', title: 'Etsy ads — first campaign', notes: 'Set up Etsy promoted listings for the top three products. Daily budget £5 to start. Will review after 7 days and adjust based on click through and conversion data.', colour: '#E08C46', size: 75 },
    { vd: 21, time: '', title: 'Amazon listing prep', notes: 'Approval finally came through. Started building out the Amazon listings. Different copy required — more keyword focused than the Etsy and Shopify descriptions. Will go live end of week.', colour: '#6FB7C3', size: 75 },
    { vd: 22, time: '10:00', title: 'Review push — follow up sequence', notes: 'Set up a post purchase email sequence asking for reviews at day 7 and day 14. Etsy reviews especially important at this stage for search ranking. Kept the ask friendly and low pressure.', colour: '#E08C46', size: 90 },
    { vd: 22, time: '', title: 'Portrait print — process refinement', notes: 'The portrait print workflow is taking too long per order. Investigating whether a template based approach in Procreate can cut the time without losing quality. Will test on the next three orders.', colour: '#81BB95', size: 75 },
    { vd: 23, time: '', title: 'Second content shoot — behind the scenes', notes: 'Shot a short video showing the personalisation process from order to dispatch. Authentic and process focused. This kind of content tends to perform well and builds trust with buyers who are spending £40+.', colour: '#EAC96A', size: 90 },
    { vd: 24, time: '', title: 'Month end finance review', notes: 'Month one revenue: £2,140. Cost of goods: £680. Platform fees and shipping: £310. Net before marketing: £1,150. Etsy 58%, Shopify 42%. Amazon zero — too early. On track for target if growth holds.', colour: '#AA9B87', size: 95 },
    { vd: 24, time: '', title: 'Urgent — portrait print backlog', notes: 'Six portrait print orders have slipped past the promised turnaround. Emailed each customer personally with an update and a small discount on their next order. None have complained but getting ahead of it was the right call.', colour: '#DC7F79', size: 90 },
    { vd: 25, time: '', title: 'Supplier negotiation — volume discount', notes: '', colour: '#81BB95', size: 35 },
    { vd: 26, time: '14:00', title: 'Month two planning session', notes: 'Set goals for month two. Target 80 orders, launch Amazon properly, get first 25 Etsy reviews, and test a paid Instagram campaign. Also need to look at whether a VA makes sense for order fulfilment.', colour: '#6178A0', size: 90 },
    { vd: 27, time: '', title: 'Personal — family day', notes: '', colour: '#A47F9B', size: 35 },
    { vd: 28, time: '09:00', title: 'Brand strategy deep dive', notes: 'Full day blocked for strategic planning. Reviewed the competitive landscape in detail and mapped out the 6 month product roadmap. Drafted the first version of the brand positioning document, covering target customer profiles and key differentiators versus Etsy competitors. Outlined the planned expansion into cat accessories for Q3. Worked through the influencer outreach strategy and identified 12 micro influencers in the UK pet space worth approaching. Finished the session by stress testing the financial model against three growth scenarios — conservative, expected, and optimistic. A long day but the business feels much more defined coming out of it than going in.', colour: '#6178A0', size: 420 },
    // Later (no-date) items
    { vd: -1, time: '', title: 'Set up loyalty reward scheme', notes: 'Want to offer a points based reward for repeat customers. Shopify has a few apps that handle this. Need to research options and cost before committing. Not urgent for launch but worth building in early.', colour: '#E08C46', size: 75 },
    { vd: -1, time: '', title: 'Explore wholesale enquiry — local pet shop', notes: 'Had an informal chat with the owner of a local independent pet shop who expressed interest in stocking the collars. No commitment on either side but worth following up properly once the online side is stable.', colour: '#81BB95', size: 75 },
    { vd: -1, time: '', title: 'Pinterest account setup', notes: 'Pinterest is reportedly strong for this kind of product but it\'s a whole separate content strategy. Parking this until Instagram and TikTok are running consistently.', colour: '#E08C46', size: 35 },
    { vd: -1, time: '', title: 'Custom packaging research', notes: 'Would love branded tissue paper and stickers for orders. Adds to the unboxing experience which matters for this kind of gift purchase. Need to find a supplier and work out the unit economics.', colour: '#81BB95', size: 35 },
    { vd: -1, time: '', title: 'VA research — order fulfilment', notes: 'If volume hits the month two target, fulfilment will become the bottleneck. Need to look at whether a part time VA makes sense or whether a third party fulfilment centre is a better option at that scale.', colour: '#6FB7C3', size: 35 },
  ];

  const seedHeightTemplates = [
    { vd: 0,  height_px: 260 }, { vd: 1,  height_px: 220 }, { vd: 2,  height_px: 182 },
    { vd: 3,  height_px: 165 }, { vd: 4,  height_px: 182 }, { vd: 5,  height_px: 469 },
    { vd: 6,  height_px: 167 }, { vd: 7,  height_px: 220 }, { vd: 8,  height_px: 187 },
    { vd: 9,  height_px: 205 }, { vd: 10, height_px: 167 }, { vd: 11, height_px: 260 },
    { vd: 12, height_px: 187 }, { vd: 13, height_px: 182 }, { vd: 14, height_px: 220 },
    { vd: 15, height_px: 220 }, { vd: 16, height_px: 202 }, { vd: 17, height_px: 205 },
    { vd: 18, height_px: 182 }, { vd: 19, height_px: 167 }, { vd: 20, height_px: 127 },
    { vd: 21, height_px: 245 }, { vd: 22, height_px: 260 }, { vd: 23, height_px: 182 },
    { vd: 24, height_px: 280 }, { vd: 25, height_px: 127 }, { vd: 26, height_px: 182 },
    { vd: 27, height_px: 127 }, { vd: 28, height_px: 512 },
  ];

  visibleDates.forEach(date => {
    runSql('INSERT INTO days(date, calendar_id, height_px) VALUES(?, ?, 110) ON CONFLICT(date, calendar_id) DO NOTHING;', [date, activeCalendarId || 0]);
  });

  seedTemplates.forEach(tmpl => {
    if (tmpl.vd < 0) {
      if (usingSqlRuntime) {
        db.run(
          "INSERT INTO events(date, time, title, notes, user_colour, display_size, is_seed, calendar_id) VALUES('', '', ?, ?, ?, ?, 1, ?);",
          [tmpl.title, tmpl.notes, tmpl.colour, tmpl.size || 52, activeCalendarId || 1]
        );
      } else {
        db.events.push({
          id: db.nextEventId++, date: '', time: '', title: tmpl.title, notes: tmpl.notes,
          user_colour: tmpl.colour, display_size: clamp(Math.round(Number(tmpl.size) || 52), 35, 420),
          is_all_day: 0, is_seed: 1, calendar_id: activeCalendarId || 1
        });
      }
      return;
    }

    if (tmpl.vd >= visibleDates.length) return;
    const date = visibleDates[tmpl.vd];
    if (usingSqlRuntime) {
      db.run(
        'INSERT INTO events(date, time, title, notes, user_colour, display_size, is_seed, calendar_id) VALUES(?, ?, ?, ?, ?, ?, 1, ?);',
        [date, tmpl.time, tmpl.title, tmpl.notes, tmpl.colour, tmpl.size || 52, activeCalendarId || 1]
      );
    } else {
      db.events.push({
        id: db.nextEventId++, date, time: tmpl.time, title: tmpl.title, notes: tmpl.notes,
        user_colour: tmpl.colour, display_size: clamp(Math.round(Number(tmpl.size) || 52), 35, 420),
        is_all_day: 0, is_seed: 1, calendar_id: activeCalendarId || 1
      });
    }
  });

  seedHeightTemplates.forEach(ht => {
    if (ht.vd >= visibleDates.length) return;
    const date = visibleDates[ht.vd];
    runSql(
      'INSERT INTO days(date, calendar_id, height_px) VALUES(?, ?, ?) ON CONFLICT(date, calendar_id) DO UPDATE SET height_px=excluded.height_px;',
      [date, activeCalendarId || 0, clamp(Math.round(ht.height_px), 110, 1100)]
    );
  });

  localStorage.setItem(seedInstalledKey(activeCalendarId), '1');
  localStorage.setItem(seedStartKey(activeCalendarId), startDateISO);
  persistDb();
  showStatus('Demo data added');
}

function removeSeedData(ctx) {
  const { activeCalendarId, db, usingSqlRuntime, persistDb, loadDays, loadItems, renderAll, rangeStart, rangeEnd } = ctx;
  const calId = activeCalendarId || 0;
  if (usingSqlRuntime) {
    db.run('UPDATE days SET height_px = 110 WHERE calendar_id = ? AND date IN (SELECT date FROM events WHERE is_seed = 1 AND calendar_id = ?);', [calId, calId]);
  } else {
    const seedDates = new Set(
      db.events.filter(e => Number(e.is_seed) === 1 && Number(e.calendar_id) === calId).map(e => e.date).filter(Boolean)
    );
    seedDates.forEach(date => {
      const d = db.days.find(r => r.date === date && Number(r.calendar_id) === calId);
      if (d) d.height_px = 110;
    });
  }

  if (usingSqlRuntime) {
    db.run('DELETE FROM events WHERE is_seed = 1 AND calendar_id = ?;', [calId]);
  } else {
    db.events = db.events.filter(e => !(Number(e.is_seed) === 1 && Number(e.calendar_id) === calId));
  }

  localStorage.removeItem(seedInstalledKey(activeCalendarId));
  localStorage.removeItem(seedStartKey(activeCalendarId));
  persistDb();
  loadDays({ rangeStart, rangeEnd });
  loadItems();
  renderAll();
  showStatus('Demo data removed');
}

function renderSeedDataRow(ctx) {
  const { activeCalendarId, loadDays, loadItems, renderAll, rangeStart, rangeEnd } = ctx;
  const row = document.getElementById('seed-data-row');
  if (!row) return;
  row.innerHTML = '';

  const installed = isSeedInstalled(activeCalendarId);
  const seededFrom = localStorage.getItem(seedStartKey(activeCalendarId)) || '';

  const btnGroup = document.createElement('div');
  btnGroup.className = 'seed-btn-group';

  if (installed) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'toolbar-action-btn';
    removeBtn.textContent = 'Remove Demo Data';
    removeBtn.addEventListener('click', () => {
      ctx.removeSeedData();
      renderSeedDataRow(ctx);
    });
    btnGroup.appendChild(removeBtn);
  } else {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'toolbar-action-btn';
    addBtn.textContent = 'Add Demo Data';
    addBtn.addEventListener('click', () => {
      addBtn.style.display = 'none';
      const picker = document.createElement('div');
      picker.className = 'seed-date-picker';
      const dateWrapper = document.createElement('div');
      dateWrapper.className = 'seed-data-field';
      const startLabel = document.createElement('label');
      startLabel.textContent = 'Start date';
      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.value = toISODate(new Date());
      dateWrapper.append(startLabel, dateInput);
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'toolbar-action-btn';
      confirmBtn.textContent = 'Confirm';
      confirmBtn.addEventListener('click', () => {
        const chosen = dateInput.value;
        if (!chosen) return;
        ctx.installSeedData(chosen);
        loadDays({ rangeStart, rangeEnd });
        loadItems();
        renderAll();
        renderSeedDataRow(ctx);
      });
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'toolbar-action-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => renderSeedDataRow(ctx));
      picker.append(dateWrapper, confirmBtn, cancelBtn);
      btnGroup.appendChild(picker);
    });
    btnGroup.appendChild(addBtn);
  }

  const field = document.createElement('div');
  field.className = 'seed-data-field';
  field.style.display = seededFrom ? '' : 'none';
  const label = document.createElement('label');
  label.textContent = 'Demo data start date';
  const input = document.createElement('input');
  input.type = 'text';
  input.readOnly = true;
  input.value = seededFrom ? formatFriendlyDate(seededFrom) : '';
  field.append(label, input);

  row.append(btnGroup, field);
}

export { installSeedData, removeSeedData, renderSeedDataRow, isSeedInstalled, seedInstalledKey, seedStartKey };
