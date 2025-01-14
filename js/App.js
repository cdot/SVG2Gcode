/*Copyright Tim Fleming, Crawford Currie 2014-2025. This file is part of SVGcut, see the copyright and LICENSE at the root of the distribution. */

// import "file-saver"
/* global saveAs */

// import "snapsvg"
/* global Snap */

// import "bootstrap"
/* global bootstrap */

import { ToolViewModel } from "./ToolViewModel.js";
import { OperationsViewModel } from "./OperationsViewModel.js";
import { GcodeGenerationViewModel } from "./GcodeGenerationViewModel.js";
import { TabsViewModel } from "./TabsViewModel.js";
import { MaterialViewModel } from "./MaterialViewModel.js";
import { SelectionViewModel } from "./SelectionViewModel.js";
import { CurveConversionViewModel } from "./CurveConversionViewModel.js";
import { MiscViewModel } from "./MiscViewModel.js";
import { Simulation } from "./Simulation.js";
import * as Gcode from "./Gcode.js";
//CPP import { getScript } from "./getScript.js";
import { Rect } from "./Rect.js";

// Identifiers for different groups created at the top level
// of the SVG. Assigned so we can recover groups from a
// serialised SVG.
// Note: The order the groups are created in is important. Later
// groups may obscure earlier groups during srawing and selections,
// so we always create the selection group last.
const SVG_GROUPS = [
  'content', 'toolPaths', 'combinedGeometry', 'tabs', 'selection'
];

/**
 * Singleton.
 * SVGcut makes extensive use of "knockout" to bind the various parts
 * of the UI together. You will need to understand the basics of
 * knockout to read this code.
 */
class App {

  constructor(config) {

    /**
     * Map from model name (e.g. "Operations") to the view model
     * for the relevant card. Note that all tool models share the Tool
     * UnitConverter except GcodeGenerationViewModel which has it's own,
     * specific to Gcode units.
     * @member {ViewModel[]}
     */
    this.models = {};

    /**
     * Simulation render path - there can be only one
     */
    this.renderPath = undefined;

    /**
     * The Element for the alert being used for the next tutorial step
     * @member {Element}
     * @private
     */
    this.tutorialAlert = undefined;

    /**
     * The index of the current tutorial step. -1 indicates
     * the step isn't currently shown.
     * @member {number}
     * @private
     */
    this.currentTutorialStep = -1;

    /**
     * Configuration options
     */
    this.options = config;

    // global reference to this singleton
    window.App = this;

    /**
     * The loaded SVG(s) drawing surface. This is given a default viewBox
     * of 0,0,500,500 before an SVG is loaded.
     * @member {Element}
     */
    this.mainSnap = Snap("#MainSvg");

    /**
     * SVG groups used to organising the main SVG view.
     * @member {SVGGraphicsElement}
     */
    this.svgGroups = {};
    for (const group of SVG_GROUPS) {
      const g = this.mainSnap.group();
      g.attr("id", group);
      this.svgGroups[group] = g;
    }
    this.addSVGFilters();

    // Create view models.

    this.models.Misc = new MiscViewModel();
    const unitConverter = this.models.Misc.unitConverter;

    this.models.Tool = new ToolViewModel(unitConverter);
    this.models.Material = new MaterialViewModel(unitConverter);
    this.models.CurveConversion = new CurveConversionViewModel(unitConverter);
    this.models.Selection = new SelectionViewModel();
    this.models.Operations = new OperationsViewModel(unitConverter);
    this.models.Tabs = new TabsViewModel(unitConverter);
    this.models.GcodeGeneration = new GcodeGenerationViewModel();

    /*CPP*
     * Paths to try to load CPP module asynchronously
     * @member {String[]}
     *
    this.tryCppPaths = Array.from(config.camCppPaths);
    // requires Misc model

    this.downloadCpp();
    this.models.Misc.loadedCamCpp(true); // not if downloadCpp is used
    /CPP*/

    // bootstrap is a bit crap at submenus. If we want to close a menu
    // tree when an action is selected, we have to jump through some hoops.
    // Since our actions can be classified as "choose-file" or "open-modal"
    // we can use that to trigger a close.
    document
    .querySelectorAll(".dropdown-item>.choose-file,.dropdown-item>.open-modal")
    .forEach(el => el.addEventListener("click", () => {
      const nel = document.querySelectorAll(
        ".dropdown-toggle[data-toggle='collapse']");
      nel.forEach(e => bootstrap.Dropdown.getInstance(e).hide());
    }));

    // Import an SVG file
    document.getElementById('chosenImportSVGFile')
    .addEventListener("change", event => {

      const files = event.target.files;
      for (const file of files) {
        const lert = this.showAlert("loadingSVG", "alert-info", file.name);
        const reader = new FileReader();
        reader.addEventListener("load", e => {
          this.importSvg(e.target.result);
          lert.remove();
          this.showAlert("loadedSVG", "alert-success", file.name);
          this.tutorial(2);
        });
        reader.addEventListener("abort", e => {
          lert.remove();
          this.showAlert("svgLoadAbort", "alert-danger", file.name);
        });
        reader.addEventListener("error", e => {
          lert.remove();
          console.error(e);
          this.showAlert("svgLoadError", "alert-danger");
        });
        reader.readAsText(file);
      }
    });

    this.addSVGEventHandlers();

    window.addEventListener("resize", () => {
      this.updateMainSvgSize();
      this.updateSvgAutoHeight();
      this.updateSimulationCanvasSize();
    });

    document.addEventListener("UPDATE_SIMULATION", () => {
      console.debug("Update simulation");
      if (this.simulation) {
        // Set the simulation path from the Gcode
        const uc = this.models.GcodeGeneration.unitConverter;
        const topZ = this.models.Material.topZ.toUnits(uc.units());
        const diam = this.models.Tool.diameter.toUnits(uc.units());
        const ang = this.models.Tool.angle();
        const cutterH = uc.fromUnits(1, "mm");
        const toolPath = Gcode.parse(this.models.GcodeGeneration.gcode());
        this.simulation.setPath(toolPath, topZ, diam, ang, cutterH);
      }
    });

    // Try and load default project
    this.models.Misc.loadProjectFromBrowser();

    // Complete UI initialisation of the view models
    for (const m in this.models)
      this.models[m].initialise();

    // Create the simulation canvas.
    this.simulation = new Simulation(
      "glShaders",
      document.getElementById("simulationCanvas"),
      document.getElementById('timeControl'));
  }

  /**
   * Finish initialisation, start the simulation animation.
   * @return {Promise} promise that resolves to undefined
   */
  start() {
    this.updateSvgAutoHeight();
    this.updateMainSvgSize();
    this.updateSimulationCanvasSize();

    this.tutorial(1);

    return this.simulation.start();
  }

  /**
   * Add filters to modify the rendering of SVG groups
   * @private
   */
  addSVGFilters() {
    // Add a filter to dim the content
    this.svgGroups.content.attr({
      filter: this.mainSnap.filter(
        Snap.filter.contrast(.5)).attr("filterUnits", "objectBoundingBox")
    });
  }

  /**
   * Add handlers for evenet in SVG
   */
  addSVGEventHandlers() {
    const mainSvgEl = document.getElementById("MainSvg");
    mainSvgEl
    .addEventListener("click", e => setTimeout(() => {
      if (e.detail > 1)
        return false; // ignore dblclick first click

      const element = e.target;
      if (e.target != null) {
        // Ignore clicks that are not on SVG elements
        if (this.models.Selection.clickOnSvg(Snap(e.target))) {
          if (this.models.Selection.isSomethingSelected()) {
            this.tutorial(3);
            return true;
          }
        }
      }
      return false;
    }, 200));

    mainSvgEl
    .addEventListener("dblclick", e => {
      // Select everything

      if (this.models.Selection.isSomethingSelected())
        // Deselect current selection
        this.models.Selection.clearSelection();

      const selectedPaths = this.mainSnap.selectAll('path');
      if (selectedPaths.length > 0) {
        selectedPaths.forEach(element =>
          this.models.Selection.clickOnSvg(element));
        if (this.models.Selection.isSomethingSelected())
          this.tutorial(3);
      }
    });
  }

  /*CPP*
   * Asynchronously find and load cpp interface
   *
  downloadCpp() {
    if (this.tryCppPaths.length == 0) {
      const e = "cam-cpp.js is unavailable; tried the following paths:<ul>"
            + this.options.camCppPaths.map(path => `<li>${path}</li>`).join("")
            + "</ul>";
      console.error(`Error: ${e}`);
      this.models.Misc.camCppError(e);
      return;
    }
    const nextLocation = this.tryCppPaths.shift();
    const script = `${nextLocation}/cam-cpp.js`;
    let element = document.createElement('script');
    element.setAttribute("src", script);
    document.head.appendChild(element);
    getScript(script)
    .then(() => {
      console.debug(`cam-cpp.js found at: ${script}`);
      this.models.Misc.loadedCamCpp(true);
    })
    .catch(() => this.downloadCpp());
  }
  /CPP*/

  /**
   * Show an alert
   * @param {string} id HTML name= of a message in <div id="alerts">
   * @param {string} alerttype CSS class, e.g. "alert-warning"
   * @param {object[]} params remaining paramsers are used to expan $n in the
   * message
   */
  showAlert(id, alerttype, ...params) {
    let s = document.querySelector(`#alerts>[name="${id}"]`);
    if (s) {
      s = s.innerHTML.replace(
        /\$(\d+)/g,
        (m, index) => params[index - 1]);
    } else
      s = id;
    const alDiv = document.createElement("div");
    alDiv.classList.add("alert");
    alDiv.classList.add(alerttype);
    alDiv.innerHTML = s;
    const a = document.createElement("a");
    a.append("× ");
    a.classList.add("close");
    a.classList.add("ecks");
    a.dataset.dismiss = "alert";
    alDiv.prepend(a);
    a.addEventListener("click", event => alDiv.remove());

    const alp = document.getElementById('alert_placeholder');
    alp.prepend(alDiv);

    return alDiv;
  }

  /**
   * Show the referenced modal, creating it if it is not currently shown.
   * @param {string} id the id attribute of the modal
   */
  showModal(id) {
    const el = document.getElementById(id);
    const modal = bootstrap.Modal.getOrCreateInstance(el);
    modal.show();
    return modal;
  }

  /**
   * Hide all open modals, if any.
   * @param {string} id the id attribute of the modal
   */
  hideModals() {
    const els = document.querySelectorAll(".modal");
    els.forEach(el => {
      const modal = bootstrap.Modal.getInstance(el);
      if (modal)
        modal.hide();
    });
  }

  /**
   * Get the bounding box of the main SVG.
   * @return {Rect} the BB (in px units)
   */
  getMainSvgBBox() {
    return new Rect(this.mainSnap.getBBox());
  }

  /**
   * Update the size of the simulation canvas to match
   * the size of the main SVG.
   * @private
   */
  updateSimulationCanvasSize() {
    // Get the whole middle section for width
    const middleDiv = document.getElementById("Middle");
    const mSvgW = middleDiv.clientWidth;
    // Make the simulation square
    const canvas = document.getElementById("simulationCanvas");
    canvas.setAttribute("width", mSvgW);
    canvas.setAttribute("height", mSvgW);
  }

  /**
   * Update the client size of any svg that's tagged as autoheight
   * so that the aspect ratio is preserved. This is currently only
   * used for the MaterialSvg picture.
   * @private
   */
  updateSvgAutoHeight() {
    const nodes = document.querySelectorAll("svg.autoheight");
    for (const node of nodes) {
      const ar = node.getAttribute("internalHeight")
            / node.getAttribute("internalWidth");
      node.setAttribute("clientHeight", node.clientWidth * ar);
    }
  }

  /**
   * Set the client area of the main SVG so that it fits the
   * viewing area.
   * @private
   */
  updateMainSvgSize() {
    // Get the whole middle section
    const middleDiv = document.getElementById("Middle");
    // Get the BB for the main SVG view using Snap
    const bbox = this.mainSnap.getBBox();
    // Get the actual DOM SVG and attribute it accordingly
    const mSvg = document.getElementById("MainSvg");
    mSvg.setAttribute("clientWidth", middleDiv.clientWidth);
    mSvg.setAttribute("clientHeight", Math.max(10, window.clientHeight - 120));
    mSvg.setAttribute("preserveAspectRatio", 'xMinYMin meet');
    mSvg.setAttribute(
      "viewBox", `${bbox.x - 2} ${bbox.y - 2} ${bbox.w + 4} ${bbox.h + 4}`);
  }

  /**
   * Load SVG from plain text into the "content" SVG group. This won't
   * affect the other SVG groups.
   * @param {Buffer|string} content the svg plain text
   * @private
   */
  importSvg(content) {
    this.svgGroups.content.append(Snap.parse(content));
    this.updateMainSvgSize();
  }

  /**
   * Change the tutorial alert to the given tutorial step.  Changing to a step
   * that has no message in the HTML will clear the tutorial alert. The
   * tutorial will only run through once.
   * @param {number} step the step to change to.
   */
  tutorial(step) {
    // Don't go backwards
    if (step > this.currentTutorialStep) {
      if (this.tutorialAlert)
        this.tutorialAlert.remove();
      const messEl = document.querySelector(
        `#tutorialSteps>div[name="Step${step}"]`);
      if (messEl) {
        const message = messEl.innerHTML;
        this.tutorialAlert = this.showAlert(
          "tutorialStep", "alert-info", step, message);
        this.currentTutorialStep = step;
      }
    }
  }

  /**
   * Get a hierarchical object that reflects the application state
   * in a form that can be safely serialised e.g to JSON
   * @param {boolean} template true to save a template, but not the
   * geometry
   */
  getSaveable(template) {
    const container = { model: {}, svg: {}};
    for (const m in this.models) {
      const json = this.models[m].toJson(template);
      if (json)
        container.model[this.models[m].jsonFieldName()] = json;
    }
    if (!template) {
      // We don't need to serialise the combinedGeometry (it can
      // be regenerated by recombine) or the tabs or the selection
      for (const group of [ 'content', 'toolPaths' ]) {
        container.svg[group] = this.svgGroups[group].outerSVG();
      }
    }
    return container;
  }

  /**
   * Reload application state from a hierarchical object as saved
   * by `getSaveable()`.
   * @param {object} container application state
   * @param {object[]} saveable.model mapping from model name to model state
   * @param {string[]} saveable.svg mapping from svg group name to geometry
   */
  loadSaveable(container) {
    // Clean out SVG groups (also kills filters)
    for (const group of SVG_GROUPS)
      this.svgGroups[group].clear();

    // Reload models
    for (const m in this.models) {
      this.models[m].reset();
      const json = container.model[this.models[m].jsonFieldName()];
      if (json)
        this.models[m].fromJson(json);
    }

    // Reload SVG groups
    for (const group of SVG_GROUPS) {
      if (container.svg[group]) {
        const snapEl = Snap.parse(container.svg[group]);
        // Append the reloaded content
        this.svgGroups[group].append(snapEl);
      }
    }
    this.addSVGFilters();
    this.updateMainSvgSize();
  }
}

export { App };
