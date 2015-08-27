import Element from '../../Element';
import { removeFromArray } from 'utils/array';
import { isArray } from 'utils/is';

function findParentSelect ( element ) {
	while ( element ) {
		if ( element.name === 'select' ) return element;
		element = element.parent;
	}
}

export default class Option extends Element {
	constructor ( options ) {
		const template = options.template;
		if ( !template.a ) template.a = {};

		// If the value attribute is missing, use the element's content,
		// as long as it isn't disabled
		if ( template.a.value === undefined && !( 'disabled' in template ) ) {
			template.a.value = template.f;
		}

		super( options );

		this.select = findParentSelect( this.parent );
	}

	bind () {
		if ( !this.select ) {
			super.bind();
			return;
		}

		// If the select has a value, it overrides the `selected` attribute on
		// this option - so we delete the attribute
		const selectedAttribute = this.attributeByName.selected;
		if ( selectedAttribute && this.select.getAttribute( 'value' ) !== undefined ) {
			const index = this.attributes.indexOf( selectedAttribute );
			this.attributes.splice( index, 1 );
			delete this.attributeByName.selected;
		}

		super.bind();
		this.select.options.push( this );
	}

	isSelected () {
		const optionValue = this.getAttribute( 'value' );

		if ( optionValue === undefined || !this.select ) {
			return false;
		}

		const selectValue = this.select.getAttribute( 'value' );

		if ( selectValue == optionValue ) {
			return true;
		}

		if ( this.select.getAttribute( 'multiple' ) && isArray( selectValue ) ) {
			let i = selectValue.length;
			while ( i-- ) {
				if ( selectValue[i] == optionValue ) {
					return true;
				}
			}
		}
	}

	unbind () {
		super.unbind();

		if ( this.select ) {
			removeFromArray( this.select.options, this );
		}
	}
}
