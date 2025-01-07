/*Copyright Tim Fleming, Crawford Currie 2014-2024. This file is part of SVG2Gcode, see the copyright and LICENSE at the root of the distribution. */

// import "knockout";
/* global ko */

// import "snapsvg"
/* global Snap */

import { ViewModel } from "./ViewModel.js";

const popovers = [
  { id:"inputMatClearance" }
];

class MaterialViewModel extends ViewModel {

  /**
   * @param {UnitConverter} unitConverter the UnitConverter to use
   */
  constructor(unitConverter) {
    super(unitConverter);

    this.thickness = ko.observable(unitConverter.fromUnits(10, "mm"));
    unitConverter.add(this.thickness);

    this.clearance = ko.observable(unitConverter.fromUnits(10, "mm"));
    unitConverter.add(this.clearance);

    this.zOrigin = ko.observable("Top");

    this.topZ = ko.computed(() => {
      if (this.zOrigin() == "Top")
        return 0;
      else
        return this.thickness();
    });
    unitConverter.addComputed(this.topZ);

    this.botZ = ko.computed(() => {
      if (this.zOrigin() == "Bottom")
        return 0;
      else
        return "-" + this.thickness();
    });
    unitConverter.addComputed(this.botZ);

    this.zSafeMove = ko.computed(() => {
      if (this.zOrigin() == "Top")
        return parseFloat(this.clearance());
      else
        return parseFloat(this.thickness()) + parseFloat(this.clearance());
    });
    unitConverter.addComputed(this.zSafeMove);

    function formatZ(z) {
      z = parseFloat(z);
      return z.toFixed(3);
    }

    /**
     * The little picture at the top of the card
     * @member {Snap.Element}
     */
    this.materialSvg = ko.observable(null);

    const materialSvg = Snap("#MaterialSvg");
    Snap.load("images/Material.svg", f => {
      // f is a Snap.Fragment
      materialSvg.append(f);
      this.materialSvg(materialSvg);
    });

    this.materialSvg.subscribe(newValue => {
      newValue.select("#matTopZ").node.textContent = formatZ(this.topZ());
      newValue.select("#matBotZ").node.textContent = formatZ(this.botZ());
      newValue.select("#matZSafeMove").node.textContent
      = formatZ(this.zSafeMove());
    });

    // Subscribe to range values to update the SVG picture
    this.topZ.subscribe(newValue => {
      if (this.materialSvg()) {
        this.materialSvg().select("#matTopZ").node.textContent
        = formatZ(newValue);
      }
    });

    this.botZ.subscribe(newValue => {
      if (this.materialSvg()) {
        this.materialSvg().select("#matBotZ").node.textContent
        = formatZ(newValue);
      }
    });

    this.zSafeMove.subscribe(newValue => {
      if (this.materialSvg()) {
        this.materialSvg().select("#matZSafeMove").node.textContent
        = formatZ(newValue);
      }
    });

  }

  // @override
  initialise() {
    this.addPopovers(popovers);

    ko.applyBindings(this, document.getElementById("MaterialView"));
  }
  
  // @override
  get jsonFieldName() { return "operations"; }

  // @override
  toJson() {
    return {
      thickness: this.thickness(),
      zOrigin: this.zOrigin(),
      clearance: this.clearance()
    };
  };

  // @override
  fromJson(json) {
    this.updateObservable(json, 'thickness');
    this.updateObservable(json, 'zOrigin');
    this.updateObservable(json, 'clearance');
  };
}

export { MaterialViewModel }
