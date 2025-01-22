//import "knockout";
/* global ko */

//import "snapsvg";
/* global Snap */

//import "clipper-lib";
/* global ClipperLib */

/* global App */

import { ViewModel } from "./ViewModel.js";
import { TabViewModel } from "./TabViewModel.js";

/**
 * View model for (holding) Tabs pane.
 */
class TabsViewModel extends ViewModel {

  /**
   * @param {UnitConverter} unitConverter the UnitConverter to use
   */
  constructor(unitConverter) {
    super(unitConverter);

    /**
     * List of tabs.
     * @member {observableArray.<TabViewModel>}
     */
    this.tabs = ko.observableArray();

    /**
     * Maximum depth operations may cut to when they pass over tabs
     * @member {observable.<number>}
     */
    this.maxCutDepth = ko.observable(0);
    unitConverter.add(this.maxCutDepth);
    this.maxCutDepth(App.models.Tool.passDepth() / 2);
    this.maxCutDepth.subscribe(() =>
      document.dispatchEvent(new Event("TOOL_PATHS_CHANGED")));
  }

  /**
   * @override
   */
  initialise() {
    this.addPopovers([
      {
        id: "createTabButton",
        trigger: "manual"
      },
      { id: "tabsMaxCutDepth" }
    ]);
    ko.applyBindings(this, document.getElementById("TabsView"));
  }

  /**
   * Invoked from #TabsViewPane
   */
  addTab() {
    // Get integer paths from the current selection
    const operands = App.models.Selection.getSelectedPaths();
    const tab = new TabViewModel(this.unitConverter, operands);
    tab.recombine();
    this.tabs.push(tab);

    document.dispatchEvent(new Event("TOOL_PATHS_CHANGED"));
  };

  /**
   * Remove a tab. Invoked from #TabsView
   */
  removeTab(tab) {
    tab.removeCombinedGeometry();
    this.tabs.remove(tab);
    document.dispatchEvent(new Event("TOOL_PATHS_CHANGED"));
  };

  /**
   * @override
   */
  reset() {
    for (const tab of this.tabs())
      tab.removeCombinedGeometry();
    this.tabs.removeAll();
  }

  /**
   * @override
   */
  jsonFieldName() { return "tabs"; }

  /**
   * @override
   */
  toJson(template) {
    const json = {
      maxCutDepth: this.maxCutDepth()
    };
    if (!template)
      json.tabs = this.tabs().map(tab => tab.toJson());
    return json;
  }

  /**
   * @override
   */
  fromJson(json) {
    this.updateObservable(json, 'maxCutDepth');
    if (json.tabs)
      for (const tabJson of json.tabs) {
        const tab = new TabViewModel(this.unitConverter, []);
        tab.fromJson(tabJson);
        this.tabs.push(tab);
        // No need to tab.recombine(), it's already in the json
      }
  };
}

export { TabsViewModel }
