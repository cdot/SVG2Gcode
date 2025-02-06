/*Copyright Tim Fleming, Crawford Currie 2014-2025. This file is part of SVGcut, see the copyright and LICENSE at the root of the distribution. */

//import "file-saver"
/* global saveAs */

// import "knockout"
/* global ko */

/* global App */

import { UnitConverter } from "./UnitConverter.js";
import * as Gcode from "./Gcode.js";
import { CutPath } from "./CutPath.js";
import { CutPaths } from "./CutPaths.js";
import { ViewModel } from "./ViewModel.js";
import { Rect } from "./Rect.js";

const POPOVERS = [
  { id: "gcodeUnits" },
  { id: "gcodeOrigin" },
  { id: "gcodeExtraOffsetX" },
  { id: "gcodeExtraOffsetY" },
  { id: "gcodeWidth" },
  { id: "gcodeHeight" },
  { id: "gcodeReturn00" }
];

const DEFAULT_UNITS = "mm";
const DEFAULT_ORIGIN = "SVG page";
const DEFAULT_EXTRAOFFSETX = 0;
const DEFAULT_EXTRAOFFSETY = 0;
const DEFAULT_RETURNTO00 = false;
const DEFAULT_GCODEFILENAME = "svgcut.nc";

/**
 * ViewModel for Gcode Generation panel.
 * @listens UPDATE_GCODE triggers Gcode generation
 */
class GcodeGenerationViewModel extends ViewModel {

  /**
   * Note that this view model has it's own unit converter.
   * The gcode generation will generate gcode coordinates in these
   * units. It will also display generation characteristics,
   * such as offsets, in these units.
   */
  constructor() {
    super();

    document.addEventListener("UPDATE_GCODE", () => this.generateGcode());

    /**
     * Units used in the Gcode pane, and the generated Gcode
     * @member {observable.<string>}
     */
    this.units = ko.observable(DEFAULT_UNITS);

    this.unitConverter = new UnitConverter(this.units);

    /**
     * Flag to lock out gcode generation.
     * @member {boolean}
     * @private
     */
    this.allowGen = true;

    /**
     * Gcode generated by this converter
     * @member {observable.<string>}
     */
    this.gcode = ko.observable([]);
    this.gcodeS = ko.observable("");
    this.gcode.subscribe(() => this.gcodeS(this.gcode().join("\n")));

    /**
     * Filename to store gcode in
     * @member {observable.<string>}
     */
    this.gcodeFilename = ko.observable(DEFAULT_GCODEFILENAME);

    /**
     * True to return to machine 0,0 at the end of the GCode.
     * @member {observable.<boolean>}
     */
    this.returnTo00 = ko.observable(DEFAULT_RETURNTO00);
    this.returnTo00.subscribe(
      () => document.dispatchEvent(new Event("UPDATE_GCODE")));
    this.returnTo00.subscribe(() => this.projectChanged());

    /**
     * Where the origin is one of "SVG page", "Bounding box" or
     * "Centre".
     * In SVG, the origin is at the top left, and Y increases
     * downwards. Internally we use internal coordinates, which follow
     * this pattern. Gcode, on the other hand, assumes Y increases
     * upwards. "SVG page" will align the machine origin with the lower
     * left corner of the SVG page. "Bounding box" will align with the
     * lower left corner of the work bounding box. "Centre" will align
     * with the centre of the work bounding box.
     * @member {observable.<string>}
     */
    this.origin = ko.observable(DEFAULT_ORIGIN);
    this.origin.subscribe(
      () => document.dispatchEvent(new Event("UPDATE_GCODE")));
    this.origin.subscribe(() => this.projectChanged());

    /**
     * Extra offset of the work origin from the machine origin
     * @member{observable.number}
     */
    this.extraOffsetX = ko.observable(DEFAULT_EXTRAOFFSETX);
    this.extraOffsetX.subscribe(
      () => document.dispatchEvent(new Event("UPDATE_GCODE")));
    this.extraOffsetX.subscribe(() => this.projectChanged());
    /* @todo generate G10,G54 to do this
     * For future reference:
     * G10 defines the coordinates of work offsets G54-G59
     * G10 Pn Xxxx Yxxx Zzzz
     * P1=G54.. P6=G59
     * G54..G59 are 6 possible "blank locations" - offsets for
     * workpieces on the platform, referred to as "datums".
     * Switch the datum using "G54".
     * So to set a new zero point at (7, 12):
     * G10 P1 X7 Y12 Z0
     * G54
     */

    /**
     * Extra offset of the work origin from the machine origin
     * @member{observable.number}
     */
    this.extraOffsetY = ko.observable(DEFAULT_EXTRAOFFSETY);
    this.extraOffsetY.subscribe(
      () => document.dispatchEvent(new Event("UPDATE_GCODE")));
    this.extraOffsetY.subscribe(() => this.projectChanged());

    /**
     * Width of the work BB, irrespective of the origin.
     * @member {observable.<number>}
     */
    this.bbWidth = ko.observable(0);

    /**
     * Height of the work BB, irrespective of the origin
     * @member {observable.<number>}
     */
    this.bbHeight = ko.observable(0);

    App.models.Operations.boundingBox.subscribe(
      bb => {
        this.bbWidth(
          this.unitConverter.fromUnits(bb.width, "integer").toFixed(2));
        this.bbHeight(
          this.unitConverter.fromUnits(bb.height, "integer").toFixed(2));
      });
  }

  /**
   * @override
   */
  initialise() {
    this.addPopovers(POPOVERS);

    ko.applyBindings(
      this, document.getElementById("GcodeGenerationView"));

    ko.applyBindings(
      this, document.getElementById("SaveGcodeModal"));

    ko.applyBindings(
      this, document.getElementById("ViewGcodeModal"));

    ko.applyBindings(
      this, document.getElementById("simulatePanel"));
  }

  /**
   * @override
   */
  reset() {
    this.units(DEFAULT_UNITS);
    this.origin(DEFAULT_ORIGIN);
    this.extraOffsetX(DEFAULT_EXTRAOFFSETX);
    this.extraOffsetY(DEFAULT_EXTRAOFFSETY);
    this.returnTo00(DEFAULT_RETURNTO00);
    this.gcode([]);
    this.gcodeFilename(DEFAULT_GCODEFILENAME);
    document.dispatchEvent(new Event("UPDATE_SIMULATION"));
  }

  /**
   * Get the main SVG area in gcode units
   * @return {Rect} a standard left, top, width, height rect
   */
  getSVGBB() {
    const pxBB = App.getMainSVGBBox();
    const gcodeBB = new Rect(
      this.unitConverter.fromUnits(pxBB.x, "px"),
      this.unitConverter.fromUnits(pxBB.y, "px"),
      this.unitConverter.fromUnits(pxBB.width, "px"),
      this.unitConverter.fromUnits(pxBB.height, "px")
    );
    return gcodeBB;
  }

  /**
   * Generate gcode for the tool paths specified by the selected
   * operations in the Operations card
   * @private
   */
  generateGcode() {
    if (!this.allowGen)
      return;

    // Get the set of enabled operations
    const ops = [];
    for (const op of App.models.Operations.operations()) {
      if (op.enabled()) {
        if (op.toolPaths() != null && op.toolPaths().length > 0)
          ops.push(op);
      }
    }
    if (ops.length === 0)
      return;

    const gunits = this.unitConverter.units();

    // Work out origin offset
    const svgBB = this.getSVGBB();
    let ox = svgBB.left + this.extraOffsetX();
    let oy = svgBB.bottom + this.extraOffsetY();
    if (this.origin() === "Bounding box" || this.origin() === "Centre") {
      const tpBB = this.unitConverter.fromUnits(
        App.models.Operations.getBounds(), "integer");
      ox += tpBB.left - svgBB.left;
      oy += svgBB.bottom - tpBB.bottom;
      if (this.origin() === "Centre") {
        ox += tpBB.width / 2;
        oy += tpBB.height / 2;
      }
    }
    console.log("WANKER", this.origin()," ",ox," ",oy);
    const job = new Gcode.Generator({
      gunits:         gunits,
      // Scaling to apply to internal units in paths, to generate Gcode units.
      xScale:         UnitConverter.from.integer.to[gunits],
      yScale:         -UnitConverter.from.integer.to[gunits],
      zScale:         1,
      decimal:        2, // 100th mm
      topZ:           App.models.Material.topZ.toUnits(gunits),
      botZ:           App.models.Material.botZ.toUnits(gunits),
      safeZ:          App.models.Material.zSafeMove.toUnits(gunits),
      passDepth:      App.models.Tool.passDepth.toUnits(gunits),
      plungeFeed:     App.models.Tool.plungeRate.toUnits(gunits),
      retractFeed:    App.models.Tool.rapidRate.toUnits(gunits),
      cutFeed:        App.models.Tool.cutRate.toUnits(gunits),
      rapidFeed:      App.models.Tool.rapidRate.toUnits(gunits),
      returnTo00:     this.returnTo00(),
      workWidth:      Number(this.bbWidth()),
      workHeight:     Number(this.bbHeight()),
      offsetX:        ox,
      offsetY:        oy
    });

    // tabs
    const tabCutDepth = App.models.Tabs.maxCutDepth.toUnits(gunits);
    job.tabZ = job.topZ - tabCutDepth;

    if (job.passDepth < 0) {
      App.showAlert("passDepthTooSmall", "alert-warning", job.passDepth);
      // Plough on; we might be behaving as a plotter
      job.passDepth = 0;
    }

    let tabGeometry = new CutPaths();
    const tabs = App.models.Tabs.tabs();
    for (const tab of tabs) {
      if (tab.enabled()) {
        // Bloat tab geometry by the cutter radius
        const bloat = App.models.Tool.diameter.toUnits("integer") / 2;
        const tg = tab.combinedGeometry.offset(bloat);
        tabGeometry = tabGeometry.union(tg);
      }
    }
    job.tabGeometry = tabGeometry;

    for (const op of ops) {
      const precalc = op.operation() === App.Ops.Perforate ||
            op.operation() === App.Ops.Drill;
      const opCard = {
        name: op.name(),
        cutType: op.operation(),
        paths: op.toolPaths(),
        ramp: op.ramp(),
        cutDepth: Number(op.cutDepth()),
        direction: op.direction(),
        spinSpeed: op.spindleSpeed(),
        // Perforation and Drill are always single-pass and cut
        // directly to the maximum operation cut depth
        passDepth: precalc ? Number(op.cutDepth()) : job.passDepth,
        precalculatedZ: precalc
      };
      if (opCard.cutDepth < 0) {
        App.showAlert("cutDepthTooSmall", "alert-warning");
        // 0 cut depth might be right for plotting
        opCard.cutDepth = 0;
      }

      job.addOperation(opCard);
    }

    // Save the gcode to the observable
    this.gcode(job.end());

    document.dispatchEvent(new Event("UPDATE_SIMULATION"));

    App.tutorial(5);
  }

  haveGcode() {
    const gc = this.gcode();
    return gc && gc.length > 0;
  }

  viewGcode() {
    App.showModal('ViewGcodeModal');
  }

  /**
   * Support for storing gcode in local files.
   * Saves the gcode and hides the modal that invoked the function.
   */
  saveGcodeInFile() {
    App.hideModals();

    if (!this.haveGcode())
      return;

    const gcode = this.gcode().join("\n");
    const blob = new Blob([gcode], {type: 'text/plain'});
    saveAs(blob, this.gcodeFilename());
  }

  /**
   * @override
   */
  jsonFieldName() { return 'gcodeConversion'; }

  /**
   * @override
   */
  toJson() {
    return {
      units: this.unitConverter.units(),
      gcodeFilename: this.gcodeFilename(),
      origin: this.origin(),
      returnTo00: this.returnTo00(),
      extraOffsetX: this.extraOffsetX(),
      extraOffsetY: this.extraOffsetY()
    };
  }

  /**
   * @override
   */
  fromJson(json) {
    this.updateObservable(json, 'units');
    this.updateObservable(json, 'gcodeFilename');
    this.updateObservable(json, 'origin');
    this.updateObservable(json, 'returnTo00');
    this.updateObservable(json, 'extraOffsetX');
    this.updateObservable(json, 'extraOffsetY');
  };
}

export { GcodeGenerationViewModel }
