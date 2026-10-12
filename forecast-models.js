'use strict';
/**
 * Forecasts made from history: what the weather is about to do, compared with
 * what is normal for that place and that time of year.
 *
 * Until this file, every outlook the site published restated a danger an
 * agency had already reported. None was made in advance, so the accuracy page
 * had no hit rate to show. These models look at the coming week's weather
 * forecast for a fixed set of places and say, before anything has happened,
 * where conditions are expected to go past what that place sees on its worst
 * days of the year:
 *
 *   heat   daily maximum temperature above the place's own 95th percentile
 *          for that date, from 30 years of record (1991-2020);
 *   rain   one-day or three-day rainfall above the place's 99th percentile
 *          for that month, the trigger for flash floods and landslides, made
 *          worse when the soil is already wetter than usual;
 *   fire   the Canadian Fire Weather Index above both its "very high" class
 *          and the place's own 95th percentile for that month.
 *
 * And, separately, the chance of aftershocks after a large earthquake, from
 * the Reasenberg-Jones model. That one is never a forecast made in advance:
 * it is conditional on an earthquake that has already happened.
 *
 * Every number here is computed from data; none is typed in. The thresholds
 * are percentiles of the place's own history, so a hot day in Delhi and a hot
 * day in London are each judged against their own normal.
 *
 * Loaded as a plain script in the browser (window.PNDModels) and required by
 * the build and run tools and the tests.
 */
(function (root) {

  /* ------------------------------------------------------------ numbers */

  /** The q-quantile of an already-sorted array, by linear interpolation. */
  function quantileSorted(s, q) {
    if (!s.length) return null;
    var pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function quantile(values, q) {
    var s = values.filter(isFinite).slice().sort(function (a, b) { return a - b; });
    return quantileSorted(s, q);
  }
  function round(v, d) { var k = Math.pow(10, d || 0); return Math.round(v * k) / k; }
  function mean(a) { var s = 0, n = 0; a.forEach(function (v) { if (isFinite(v)) { s += v; n++; } }); return n ? s / n : null; }

  /** Day of year, 1-366, of a YYYY-MM-DD date, treated as UTC. */
  function dayOfYear(ymd) {
    var t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
    return Math.floor((t - Date.UTC(+ymd.slice(0, 4), 0, 1)) / 864e5) + 1;
  }
  function monthOf(ymd) { return +ymd.slice(5, 7); }

  /* ------------------------------------------------- seasonal thresholds */

  /*
   * A threshold that follows the seasons, kept as a short sum of sines.
   *
   * The percentile for each calendar day is taken over a 15-day window centred
   * on it in every year of the record, which is how heatwave indices such as
   * the WMO's are defined, and then smoothed by fitting an annual cycle with
   * three harmonics. The raw daily values are noisy from one day to the next
   * by chance alone; the fitted curve is the seasonal threshold they estimate,
   * and it stores in seven numbers instead of 366. How far the fit strays from
   * the raw values is recorded with it, so a place where it fits badly can be
   * seen rather than assumed away.
   */
  var HARMONICS = 3;
  function fitHarmonics(values) { // values[0..365] for day of year 1..366
    var n = values.length, cols = 1 + 2 * HARMONICS;
    var X = [], y = [];
    for (var i = 0; i < n; i++) {
      if (!isFinite(values[i])) continue;
      var w = 2 * Math.PI * (i + 1) / 366, row = [1];
      for (var k = 1; k <= HARMONICS; k++) row.push(Math.cos(k * w), Math.sin(k * w));
      X.push(row); y.push(values[i]);
    }
    // Normal equations, solved by Gaussian elimination: seven unknowns.
    var A = [], b = [];
    for (var r = 0; r < cols; r++) {
      A.push(new Array(cols).fill(0)); b.push(0);
      for (var j = 0; j < X.length; j++) {
        for (var c = 0; c < cols; c++) A[r][c] += X[j][r] * X[j][c];
        b[r] += X[j][r] * y[j];
      }
    }
    for (var p = 0; p < cols; p++) {
      var piv = p;
      for (var q = p + 1; q < cols; q++) if (Math.abs(A[q][p]) > Math.abs(A[piv][p])) piv = q;
      var t = A[p]; A[p] = A[piv]; A[piv] = t; var tb = b[p]; b[p] = b[piv]; b[piv] = tb;
      for (var r2 = p + 1; r2 < cols; r2++) {
        var f = A[r2][p] / A[p][p];
        for (var c2 = p; c2 < cols; c2++) A[r2][c2] -= f * A[p][c2];
        b[r2] -= f * b[p];
      }
    }
    var coef = new Array(cols).fill(0);
    for (var i2 = cols - 1; i2 >= 0; i2--) {
      var s = b[i2];
      for (var j2 = i2 + 1; j2 < cols; j2++) s -= A[i2][j2] * coef[j2];
      coef[i2] = s / A[i2][i2];
    }
    var sq = 0;
    for (var m = 0; m < X.length; m++) { var e = harmonicAt(coef, null, X[m]) - y[m]; sq += e * e; }
    return { coef: coef.map(function (v) { return round(v, 3); }), rms: round(Math.sqrt(sq / X.length), 2) };
  }
  function harmonicAt(coef, doy, row) {
    if (!row) {
      var w = 2 * Math.PI * doy / 366; row = [1];
      for (var k = 1; k <= HARMONICS; k++) row.push(Math.cos(k * w), Math.sin(k * w));
    }
    var s = 0; for (var i = 0; i < coef.length; i++) s += coef[i] * row[i]; return s;
  }

  /** Percentile of daily maximum temperature by day of year, 15-day window. */
  function dailyPercentiles(days, values, q, halfWindow) {
    halfWindow = halfWindow === undefined ? 7 : halfWindow;
    var byDoy = []; for (var d = 0; d < 366; d++) byDoy.push([]);
    for (var i = 0; i < days.length; i++) if (isFinite(values[i])) byDoy[dayOfYear(days[i]) - 1].push(values[i]);
    var out = [];
    for (var d2 = 0; d2 < 366; d2++) {
      var pool = [];
      for (var o = -halfWindow; o <= halfWindow; o++) pool = pool.concat(byDoy[(d2 + o + 366) % 366]);
      out.push(pool.length >= 30 ? quantile(pool, q) : NaN);
    }
    return out;
  }

  /** Percentiles by calendar month: [Jan..Dec], each over every day of that month in the record. */
  function monthlyPercentiles(days, values, q) {
    var by = []; for (var m = 0; m < 12; m++) by.push([]);
    for (var i = 0; i < days.length; i++) if (isFinite(values[i])) by[monthOf(days[i]) - 1].push(values[i]);
    return by.map(function (a) { return a.length >= 30 ? round(quantile(a, q), 2) : null; });
  }

  /** Running n-day sums, aligned to the last day of each window. */
  function rollingSum(values, n) {
    var out = [], s = 0, bad = 0;
    for (var i = 0; i < values.length; i++) {
      var v = values[i]; if (isFinite(v)) s += v; else bad++;
      if (i >= n) { var u = values[i - n]; if (isFinite(u)) s -= u; else bad--; }
      out.push(i >= n - 1 && bad === 0 ? s : NaN);
    }
    return out;
  }

  /* -------------------------------------------- Canadian Fire Weather Index */

  /*
   * The Canadian Forest Fire Weather Index System (Van Wagner 1987), the index
   * the European and Global Wildfire Information Systems publish worldwide.
   * Three moisture codes carry memory from day to day - fine fuels (FFMC),
   * loosely compacted organic layers (DMC) and deep compact layers (DC) - and
   * are combined with wind into the spread and buildup indices and the final
   * FWI. Inputs are noon temperature (C), relative humidity (%), 10 m wind
   * (km/h) and 24-hour rain (mm).
   *
   * Day-length factors follow the cffdrs reference implementation, including
   * its adjustments for the tropics and the southern hemisphere.
   */
  var EL_N = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0];
  var EL_S = [11.5, 10.5, 9.2, 7.9, 6.8, 6.2, 6.5, 7.4, 8.7, 10.0, 11.2, 11.8];
  var FL_N = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6];
  var FL_S = [6.4, 5.0, 2.4, 0.4, -1.6, -1.6, -1.6, -1.6, -1.6, 0.9, 3.8, 5.8];

  function ffmcNext(ffmc0, T, rh, ws, rain) {
    var mo = 147.2 * (101 - ffmc0) / (59.5 + ffmc0);
    if (rain > 0.5) {
      var rf = rain - 0.5;
      var add = 42.5 * rf * Math.exp(-100 / (251 - mo)) * (1 - Math.exp(-6.93 / rf));
      if (mo > 150) add += 0.0015 * Math.pow(mo - 150, 2) * Math.sqrt(rf);
      mo = Math.min(250, mo + add);
    }
    var ed = 0.942 * Math.pow(rh, 0.679) + 11 * Math.exp((rh - 100) / 10) + 0.18 * (21.1 - T) * (1 - Math.exp(-0.115 * rh));
    var m;
    if (mo > ed) {
      var ko = 0.424 * (1 - Math.pow(rh / 100, 1.7)) + 0.0694 * Math.sqrt(ws) * (1 - Math.pow(rh / 100, 8));
      var kd = ko * 0.581 * Math.exp(0.0365 * T);
      m = ed + (mo - ed) * Math.pow(10, -kd);
    } else {
      var ew = 0.618 * Math.pow(rh, 0.753) + 10 * Math.exp((rh - 100) / 10) + 0.18 * (21.1 - T) * (1 - Math.exp(-0.115 * rh));
      if (mo < ew) {
        var k1 = 0.424 * (1 - Math.pow((100 - rh) / 100, 1.7)) + 0.0694 * Math.sqrt(ws) * (1 - Math.pow((100 - rh) / 100, 8));
        var kw = k1 * 0.581 * Math.exp(0.0365 * T);
        m = ew - (ew - mo) * Math.pow(10, -kw);
      } else m = mo;
    }
    return Math.max(0, Math.min(101, 59.5 * (250 - m) / (147.2 + m)));
  }

  function dmcNext(dmc0, T, rh, rain, month, lat) {
    var el = lat > 10 ? EL_N[month - 1] : lat < -10 ? EL_S[month - 1] : 9;
    var t = Math.max(T, -1.1);
    var rk = 1.894 * (t + 1.1) * (100 - rh) * el * 1e-4;
    var pr = dmc0;
    if (rain > 1.5) {
      var rw = 0.92 * rain - 1.27;
      var wmi = 20 + 280 / Math.exp(0.023 * dmc0);
      var b = dmc0 <= 33 ? 100 / (0.5 + 0.3 * dmc0)
        : dmc0 <= 65 ? 14 - 1.3 * Math.log(dmc0) : 6.2 * Math.log(dmc0) - 17.2;
      var wmr = wmi + 1000 * rw / (48.77 + b * rw);
      pr = 43.43 * (5.6348 - Math.log(wmr - 20));
    }
    return Math.max(0, Math.max(0, pr) + rk);
  }

  function dcNext(dc0, T, rain, month, lat) {
    var fl = lat > 10 ? FL_N[month - 1] : lat < -10 ? FL_S[month - 1] : 1.4;
    var t = Math.max(T, -2.8);
    var pe = Math.max(0, (0.36 * (t + 2.8) + fl) / 2);
    var dr = dc0;
    if (rain > 2.8) {
      var rd = 0.83 * rain - 1.27;
      var qr = 800 * Math.exp(-dc0 / 400) + 3.937 * rd;
      dr = Math.max(0, 400 * Math.log(800 / qr));
    }
    return Math.max(0, dr + pe);
  }

  function isiOf(ffmc, ws) {
    var fm = 147.2 * (101 - ffmc) / (59.5 + ffmc);
    var sf = 19.115 * Math.exp(-0.1386 * fm) * (1 + Math.pow(fm, 5.31) / 4.93e7);
    return sf * Math.exp(0.05039 * ws);
  }
  function buiOf(dmc, dc) {
    if (dmc <= 0 && dc <= 0) return 0;
    var bui = dmc <= 0.4 * dc
      ? 0.8 * dc * dmc / (dmc + 0.4 * dc)
      : dmc - (1 - 0.8 * dc / (dmc + 0.4 * dc)) * (0.92 + Math.pow(0.0114 * dmc, 1.7));
    return Math.max(0, bui);
  }
  function fwiOf(isi, bui) {
    var bb = bui <= 80 ? 0.1 * isi * (0.626 * Math.pow(bui, 0.809) + 2)
      : 0.1 * isi * (1000 / (25 + 108.64 * Math.exp(-0.023 * bui)));
    return bb <= 1 ? bb : Math.exp(2.72 * Math.pow(0.434 * Math.log(bb), 0.647));
  }

  /** One day of the system: yesterday's codes in, today's codes and indices out. */
  function fwiDay(prev, w, month, lat) {
    var ffmc = ffmcNext(prev.ffmc, w.temp, w.rh, w.wind, w.rain);
    var dmc = dmcNext(prev.dmc, w.temp, w.rh, w.rain, month, lat);
    var dc = dcNext(prev.dc, w.temp, w.rain, month, lat);
    var isi = isiOf(ffmc, w.wind), bui = buiOf(dmc, dc);
    return { ffmc: ffmc, dmc: dmc, dc: dc, isi: isi, bui: bui, fwi: fwiOf(isi, bui) };
  }
  /* The standard start-up values, used at the start of a run of days. */
  var FWI_START = { ffmc: 85, dmc: 6, dc: 15 };

  /**
   * The FWI for each day of a series. A day with missing weather breaks the
   * chain: its value is null and the codes restart from the standard values
   * after it, since carrying a guess forward would put a number on days the
   * data cannot support.
   */
  function fwiSeries(days, wx, lat) {
    var prev = FWI_START, out = [];
    for (var i = 0; i < days.length; i++) {
      var w = wx[i];
      if (!w || ![w.temp, w.rh, w.wind, w.rain].every(isFinite)) { out.push(null); prev = FWI_START; continue; }
      var d = fwiDay(prev, { temp: w.temp, rh: Math.min(100, Math.max(0, w.rh)), wind: Math.max(0, w.wind), rain: Math.max(0, w.rain) }, monthOf(days[i]), lat);
      out.push(d.fwi); prev = d;
    }
    return out;
  }

  /* The FWI danger classes the European Forest Fire Information System uses. */
  var FWI_CLASSES = [
    { min: 50, label: 'very extreme' }, { min: 38, label: 'extreme' },
    { min: 21.3, label: 'very high' }, { min: 11.2, label: 'high' },
    { min: 5.2, label: 'moderate' }, { min: 0, label: 'low' }
  ];
  function fwiClass(v) { for (var i = 0; i < FWI_CLASSES.length; i++) if (v >= FWI_CLASSES[i].min) return FWI_CLASSES[i].label; return 'low'; }

  /** Relative humidity (%) from temperature and dew point (C), Magnus formula. */
  function rhFrom(T, Td) {
    var a = 17.625, b = 243.04;
    return Math.max(0, Math.min(100, 100 * Math.exp(a * Td / (b + Td) - a * T / (b + T))));
  }

  /* ------------------------------------------ Reasenberg-Jones aftershocks */

  /*
   * The rate of aftershocks of magnitude m or more, t days after a mainshock
   * of magnitude Mm, is 10^(a + b(Mm - m)) * (t + c)^-p (Reasenberg & Jones,
   * Science 1989). The parameters here are their generic values, fitted to
   * California sequences; the USGS starts from comparable generic values and
   * refines them as a sequence develops. A generic model is a reasonable
   * first estimate anywhere and a worse one than a fitted sequence, which is
   * said wherever the numbers are shown.
   */
  var RJ_GENERIC = { a: -1.67, b: 0.91, p: 1.08, c: 0.05 };

  /** Expected number of aftershocks >= m between t1 and t2 days after the mainshock. */
  function rjExpected(Mm, m, t1, t2, prm) {
    prm = prm || RJ_GENERIC;
    var k = Math.pow(10, prm.a + prm.b * (Mm - m));
    var f = function (t) { return Math.pow(t + prm.c, 1 - prm.p) / (1 - prm.p); };
    return k * (f(t2) - f(t1));
  }
  /** Chance of at least one aftershock >= m in that interval (Poisson). */
  function rjProbability(Mm, m, t1, t2, prm) {
    var n = rjExpected(Mm, m, t1, t2, prm);
    return n > 0 ? 1 - Math.exp(-n) : 0;
  }

  /* ---------------------------------------------------- bias correction */

  /*
   * The thresholds come from one dataset (NASA POWER, built on the MERRA-2
   * reanalysis) and the coming week from another (the Open-Meteo forecast
   * models). Two datasets disagree about the same place by a degree or two as
   * a matter of course, and at the 95th percentile that is the difference
   * between an alert and none. So each run compares the two over the days
   * both cover - the forecast service's record of recent days and POWER's -
   * and removes the average difference. Fewer than MIN_OVERLAP shared days and
   * there is no correction to make, so that place is skipped and the run says
   * so, rather than comparing two things that may be offset.
   */
  var MIN_OVERLAP = 15;
  /* Only the most recent three weeks are compared. Measured: over the 57
     days both datasets covered in August-October 2026 the forecast service
     ran 2 to 3.7 C cooler than POWER at Indian cities - a monsoon-season
     difference - and applying it to mid-October's clear days raised every
     forecast high by that much and put 79 of 108 places into a heat alert. */
  var BIAS_WINDOW = 21, MAX_SHIFT_C = 3;
  /** Mean difference over the last BIAS_WINDOW days both cover. A shift
      larger than MAX_SHIFT_C is not trusted: the two datasets disagree by
      more than a correction can honestly bridge, and the place is skipped. */
  function biasDelta(days, fc, ref, maxShift) {
    var d = [];
    for (var i = days.length - 1; i >= 0 && d.length < BIAS_WINDOW; i--) if (isFinite(fc[i]) && isFinite(ref[i])) d.push(fc[i] - ref[i]);
    if (d.length < MIN_OVERLAP) return { delta: null, n: d.length };
    var m = mean(d);
    if (maxShift !== undefined && Math.abs(m) > maxShift) return { delta: null, n: d.length, tooLarge: m };
    return { delta: m, n: d.length };
  }
  /** For rain, a ratio of totals rather than a difference, held to a sane range. */
  function rainRatio(days, fc, ref) {
    var a = 0, b = 0, n = 0;
    for (var i = days.length - 1; i >= 0 && n < BIAS_WINDOW; i--) if (isFinite(fc[i]) && isFinite(ref[i])) { a += fc[i]; b += ref[i]; n++; }
    if (n < MIN_OVERLAP) return { ratio: null, n: n };
    if (a < 10 || b < 10) return { ratio: 1, n: n, note: 'too little rain in the shared days to compare' };
    return { ratio: Math.max(0.5, Math.min(2, b / a)), n: n };
  }

  /* ------------------------------------------------------------- models */

  /** Consecutive runs of true values, as [startIndex, endIndex] pairs. */
  function runs(flags) {
    var out = [], s = -1;
    for (var i = 0; i <= flags.length; i++) {
      if (i < flags.length && flags[i]) { if (s < 0) s = i; }
      else if (s >= 0) { out.push([s, i - 1]); s = -1; }
    }
    return out;
  }

  var HEAT_MIN_DAYS = 2;
  /**
   * Heat: days whose forecast maximum, corrected to the climatology's scale,
   * reaches the place's 95th percentile for that date. Two or more in a row
   * make an outlook; a day above the 99th makes it severe.
   */
  function heatModel(clim, days, tmaxCorrected) {
    var p95 = days.map(function (d) { return harmonicAt(clim.heat.p95, dayOfYear(d)); });
    var p99 = days.map(function (d) { return harmonicAt(clim.heat.p99, dayOfYear(d)); });
    var flags = days.map(function (d, i) { return isFinite(tmaxCorrected[i]) && tmaxCorrected[i] >= p95[i]; });
    return runs(flags).filter(function (r) { return r[1] - r[0] + 1 >= HEAT_MIN_DAYS; }).map(function (r) {
      var idx = []; for (var i = r[0]; i <= r[1]; i++) idx.push(i);
      var peak = Math.max.apply(null, idx.map(function (i) { return tmaxCorrected[i]; }));
      var severe = idx.some(function (i) { return tmaxCorrected[i] >= p99[i]; });
      return {
        hazard: 'heat', start: days[r[0]], end: days[r[1]], days: idx.length, severe: severe,
        detail: idx.map(function (i) { return { day: days[i], value: round(tmaxCorrected[i], 1), p95: round(p95[i], 1), p99: round(p99[i], 1) }; }),
        peak: round(peak, 1)
      };
    });
  }

  /**
   * Rain: a day whose corrected forecast rain reaches the month's 99th
   * percentile of daily rain, or a three-day total reaching the 99th
   * percentile of three-day totals. Soil already wetter than its 80th
   * percentile for the month makes it severe, because wet ground sends more
   * of the rain straight to rivers and slopes.
   */
  function rainModel(clim, days, rainCorrected, soilPercentile) {
    var r3 = rollingSum(rainCorrected, 3);
    var flags = days.map(function (d, i) {
      var m = monthOf(d) - 1;
      var one = clim.rain.p99[m], three = clim.rain.p99x3[m];
      return (isFinite(rainCorrected[i]) && one !== null && rainCorrected[i] >= one && rainCorrected[i] >= 10) ||
        (isFinite(r3[i]) && three !== null && r3[i] >= three && r3[i] >= 20);
    });
    var wet = isFinite(soilPercentile) && soilPercentile >= 0.8;
    return runs(flags).map(function (r) {
      var idx = []; for (var i = r[0]; i <= r[1]; i++) idx.push(i);
      return {
        hazard: 'rain', start: days[r[0]], end: days[r[1]], days: idx.length, severe: wet,
        soilPercentile: isFinite(soilPercentile) ? round(soilPercentile, 2) : null,
        detail: idx.map(function (i) {
          var m = monthOf(days[i]) - 1;
          return { day: days[i], value: round(rainCorrected[i], 1), threeDay: isFinite(r3[i]) ? round(r3[i], 1) : null, p99: clim.rain.p99[m], p99x3: clim.rain.p99x3[m] };
        }),
        peak: round(Math.max.apply(null, idx.map(function (i) { return rainCorrected[i]; })), 1)
      };
    });
  }

  var FIRE_MIN_DAYS = 2, FIRE_FLOOR = 21.3;
  /**
   * Fire weather: FWI at or above the "very high" class and above the place's
   * own 95th percentile for the month, on two or more days in a row. The
   * percentile keeps a desert, where the index runs high all year over ground
   * with nothing to burn, from raising an alarm every day; the floor keeps a
   * wet place's unusual-but-harmless day from raising one either. Fire needs
   * fuel and a spark as well, which no weather index can see.
   */
  function fireModel(clim, days, fwi) {
    var flags = days.map(function (d, i) {
      var p95 = clim.fire.p95[monthOf(d) - 1];
      return isFinite(fwi[i]) && fwi[i] !== null && p95 !== null && fwi[i] >= FIRE_FLOOR && fwi[i] >= p95;
    });
    return runs(flags).filter(function (r) { return r[1] - r[0] + 1 >= FIRE_MIN_DAYS; }).map(function (r) {
      var idx = []; for (var i = r[0]; i <= r[1]; i++) idx.push(i);
      var peak = Math.max.apply(null, idx.map(function (i) { return fwi[i]; }));
      return {
        hazard: 'fire', start: days[r[0]], end: days[r[1]], days: idx.length, severe: peak >= 38,
        detail: idx.map(function (i) { return { day: days[i], value: round(fwi[i], 1), p95: clim.fire.p95[monthOf(days[i]) - 1], level: fwiClass(fwi[i]) }; }),
        peak: round(peak, 1)
      };
    });
  }

  /** Where a value falls in a sorted reference distribution, 0..1. */
  function percentileOf(sortedRef, v) {
    if (!sortedRef || !sortedRef.length || !isFinite(v)) return NaN;
    var lo = 0; while (lo < sortedRef.length && sortedRef[lo] <= v) lo++;
    return lo / sortedRef.length;
  }

  var api = {
    quantile: quantile, quantileSorted: quantileSorted, dayOfYear: dayOfYear, monthOf: monthOf,
    dailyPercentiles: dailyPercentiles, monthlyPercentiles: monthlyPercentiles, rollingSum: rollingSum,
    fitHarmonics: fitHarmonics, harmonicAt: harmonicAt, HARMONICS: HARMONICS,
    ffmcNext: ffmcNext, dmcNext: dmcNext, dcNext: dcNext, isiOf: isiOf, buiOf: buiOf, fwiOf: fwiOf,
    fwiDay: fwiDay, fwiSeries: fwiSeries, FWI_START: FWI_START, FWI_CLASSES: FWI_CLASSES, fwiClass: fwiClass,
    rhFrom: rhFrom,
    RJ_GENERIC: RJ_GENERIC, rjExpected: rjExpected, rjProbability: rjProbability,
    MIN_OVERLAP: MIN_OVERLAP, BIAS_WINDOW: BIAS_WINDOW, MAX_SHIFT_C: MAX_SHIFT_C, biasDelta: biasDelta, rainRatio: rainRatio,
    runs: runs, heatModel: heatModel, rainModel: rainModel, fireModel: fireModel,
    HEAT_MIN_DAYS: HEAT_MIN_DAYS, FIRE_MIN_DAYS: FIRE_MIN_DAYS, FIRE_FLOOR: FIRE_FLOOR,
    percentileOf: percentileOf, round: round, mean: mean
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PNDModels = api;
})(typeof window !== 'undefined' ? window : null);
